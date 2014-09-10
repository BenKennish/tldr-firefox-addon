/*
 a very rough prototype to add TLDR (Trusted Linker Download Redirect) support to Firefox
 - Ben Kennish <ben@kennish.net>
 */

// use Cc instead of Components.classes
// use Ci instead of Components.interfaces
// use Cr instead of Components.results
// use Cu instead of Components.utils
const {Cc,Ci,Cr,Cu} = require("chrome");
// FIXME: constants declared in global namespace

// create the 'namespace'
if (!net) var net = {};
if (!net.bennish) net.bennish = {};

net.bennish.tldr =
{
    // these should be constants but are actually variables
    HEADER_NAME_CHECKSUM_SHA1: 'TLDR-Checksum-SHA1',
    //HTTP_RESPONSE_CODE_FOUND: 302,
    HTTP_RESPONSE_CODES_TO_LISTEN_FOR: [302, 303, 307],
    // TLDR should be used with all forms of temporary redirect:
    // 302 Found, 303 See Other (HTTP/1.1), and 307 Temporary Redirect (HTTP/1.1),

    PAUSE_BEFORE_DELETE_BAD_DOWNLOAD_MS: 10000,
    //TODO: we should just delete when we can, not wait some time and then try once

    // an "associative array object" to store our hashes and stuff in
    links: {},

    // we want console.warn() to be visible too (default is console.error only)

    init: function()
    {

        var currentLogLevel = require("sdk/preferences/service").get("extensions.tldr@bennish.net.sdk.console.logLevel");

        if (currentLogLevel == 'error')
            require("sdk/preferences/service").set("extensions.tldr@bennish.net.sdk.console.logLevel", "warn");

        this.httpResponseObserver.register();

        // TODO: we should probably be calling this at some point! <-----------------------------------
        //httpResponseObserver.unregister();

        Cu.import("resource://gre/modules/Task.jsm");

        Task.spawn(function ()
        {
            // used for download manager stuff
            Cu.import("resource://gre/modules/Downloads.jsm");

            //Cu.import("resource://gre/modules/FileUtils.jsm");

            let list = yield Downloads.getList(Downloads.ALL);

            let view =
            {
                onDownloadAdded: download =>
                {
                    console.log("Download Added:", download);

                    //TODO: show a notification or something if TLDR is active!
                    //TODO: move the info from the tldr into the download object
                },

                onDownloadChanged: download =>
                {
                    if (download.succeeded && download.stopped)
                    {
                        console.log("A download just completed!");
                        console.log("Source:", download.source.url);
                        console.log("Referrer:", download.source.referrer);
                        console.log("Target:", download.target.path);

                        // TODO: is this property correct? can we use and rely on it?
                        /*
                        var sha256 = download.saver._sha256Hash;
                        console.log("SHA256 hash?", sha256);
                        */

                        var link;

                        // first see if the referrer to the download URL is in our tldr object
                        if (download.source.referrer && net.bennish.tldr.links[download.source.referrer])
                        {
                            link = download.source.referrer;
                        }
                        else if (net.bennish.tldr.links[download.source.url])
                        {
                            link = download.source.url;
                        }

                        if (link && net.bennish.tldr.links[link])
                        {
                            console.log("SHA1 from HTTP Header:", net.bennish.tldr.links[link].sha1);

                            console.time('computeSHA1');
                            var sha1 = net.bennish.tldr.computeSHA1(download.target.path);
                            console.timeEnd('computeSHA1');

                            console.log("SHA1 calculated result: ", sha1);

                            const fileIO = require("sdk/io/file");

                            if (sha1 == net.bennish.tldr.links[link].sha1)
                            {
                                console.log("SUCCESS! It matched the header!");

                                var filename = fileIO.basename(download.target.path);
                                var trustedHost = net.bennish.tldr.links[link].trustedLinker.host;

                                if (require('sdk/simple-prefs').prefs['showNotificationOnValidate'])
                                {
                                    var notifications = require("sdk/notifications");
                                    notifications.notify(
                                    {
                                        title: filename,
                                        text: "Verified by "+trustedHost, //+" using TLDR",
                                        iconURL: require("sdk/self").data.url('tldr-icon-64x64.png'),
                                        data: undefined,// some data here?
                                        onClick: function(data)
                                        {
                                            // TODO: show some more info to the user?
                                        }
                                    });
                                }
                            }
                            else
                            {
                                console.log("FAILURE! It didn't match the header!");
                                download.launchWhenSucceeded = false;
                                download.finalize(true);

                                // remove the file from the download manager
                                list.remove(download);

                                var appData = require("sdk/self").data;

                                //TODO: Panels are crap - do this some other way

                                // show error message to user in a panel
                                var panel = require("sdk/panel").Panel(
                                {
                                    width: 750,
                                    contentURL: appData.url("checksumMismatchPanel.html"),
                                    contentScriptFile: appData.url("checksumMismatchPanel.js"),
                                    position: { top: 40 },
                                    //focus: false, // accessibility issue?
                                });

                                // this creation of 2 new vars is necessary as the panel.on('show') function cannot read tldr[link]
                                var trustedLinker = net.bennish.tldr.links[link].trustedLinker.spec;
                                var trustedLinkerReferrer = net.bennish.tldr.links[link].trustedLinkerReferrer;

                                panel.on('show', function()
                                {
                                    panel.port.emit("showPanel", download.source.url, download.target.path, trustedLinker, trustedLinkerReferrer);
                                });

                                panel.show();

                                //console.log("isFile?", fileIO.isFile(download.target.path));

                                console.log("Will remove downloaded file in "+net.bennish.tldr.PAUSE_BEFORE_DELETE_BAD_DOWNLOAD_MS+" milliseconds...");

                                timers = require("sdk/timers");

                                try
                                {
                                    timers.setTimeout(function(path)
                                    {
                                        console.log("Removing ", path);
                                        try
                                        {
                                            fileIO.remove(path);
                                        }
                                        catch (e)
                                        {
                                            console.error(e);
                                        }
                                    }, net.bennish.tldr.PAUSE_BEFORE_DELETE_BAD_DOWNLOAD_MS, download.target.path);
                                }
                                catch (e)
                                {
                                    console.error(e);
                                    // TODO: try again later?
                                }
                            }

                            //TODO: check that there are no activate downloads using this link
                            delete net.bennish.tldr.links[link];
                            console.log("Purged "+link+" from data object.  It now looks like this:", net.bennish.tldr.data);
                            console.log('----------------');
                        }
                    }
                },

                onDownloadRemoved: download =>
                {
                    //TODO: remove the entry from 'tldr'
                    //console.log("Download Removed", download)
                }
            };

            yield list.addView(view);

        }).then(null, Cu.reportError);

    },

    computeSHA1: function (path)
    {
        var file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsILocalFile);
        file.initWithPath(path);
        var istream = Cc["@mozilla.org/network/file-input-stream;1"].createInstance(Ci.nsIFileInputStream);

        // open for reading
        istream.init(file, 0x01, 0444, 0);
        var ch = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);

        // constants: MD2, MD5, SHA1, SHA256, SHA384, SHA512
        // we want to use the SHA1 algorithm
        ch.init(ch.SHA1);

        // this tells updateFromStream to read the entire file
        const PR_UINT32_MAX = 0xffffffff;
        ch.updateFromStream(istream, PR_UINT32_MAX);

        // pass false here to get binary data back
        var hash = ch.finish(false);

        // return the two-digit hexadecimal code for a byte
        function toHexString(charCode)
        {
            return ("0" + charCode.toString(16)).slice(-2);
        }

        // convert the binary hash data to a hex string.
        var s = [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");
        // s now contains your hash in hex

        return s;
    },


    httpResponseObserver:
    {
        observe : function(subject, topic, data)
        {
            var channel = subject.QueryInterface(Ci.nsIHttpChannel);

            // if the response isn't "302 Found", we aren't interested
            //if (channel.responseStatus != net.bennish.tldr.HTTP_RESPONSE_CODE_FOUND) return;

            if (net.bennish.tldr.HTTP_RESPONSE_CODES_TO_LISTEN_FOR.indexOf(channel.responseStatus) == -1) return

            // if either of these headers are not found, an exception will kick us out of this try block
            var link, sha1;

            try
            {
                link = channel.getResponseHeader('Location');
                sha1 = channel.getResponseHeader(net.bennish.tldr.HEADER_NAME_CHECKSUM_SHA1);
            }
            catch (e)
            {
                // one of the getResponseHeader calls returned NS_ERROR_NOT_AVAILABLE (header not set)
                return;
            }

            var referrer;
            if (channel.referrer)
                referrer = channel.referrer.spec;


            console.log('Received a TLDR header during a '+channel.responseStatus+' HTTP response');
            console.log(net.bennish.tldr.HEADER_NAME_CHECKSUM_SHA1+':', sha1);

            console.log("Referer:", referrer);
            console.log('Current URI:', channel.URI.spec);
            console.log('Location:', link);

            if (channel.URI.scheme != 'https')
            {
                if (require('sdk/simple-prefs').prefs['requireHTTPS'])
                {
                    console.error(channel.URI.spec+' tried to use TLDR but without HTTPS it\'s pretty much pointless...ignoring TLDR');
                    return;
                }
                else
                {
                    console.warn(channel.URI.spec+' is using TLDR but without HTTPS it\'s pretty much pointless');
                }
            }

            if (channel.URI.spec != channel.originalURI.spec)
            {
                // someone has redirected to the trusted linker
                console.warn(channel.URI.spec+" is using TLDR for an HTTP request but it isn't the first in a chain of redirects");
            }

            net.bennish.tldr.links[link] =
            {
                trustedLinkerReferrer: referrer,
                trustedLinker: channel.URI,
                sha1: sha1,
            };

            //TODO: rather that using this primitive method of matching a download to its entry
            // in the tldr object, we should latch onto this chain of HTTP connections until it
            // gets to a download /page and then attach the data to the download object
            console.log('----------------------------');

        },

        // defines a lazy getter for a field
        get observerService()
        {
            return Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
        },

        register: function()
        {
            this.observerService.addObserver(this, 'http-on-examine-response', false);
            this.observerService.addObserver(this, 'http-on-examine-cached-response', false);
        },

        unregister: function()
        {
            this.observerService.removeObserver(this, 'http-on-examine-response', false);
            this.observerService.removeObserver(this, 'http-on-examine-cached-response', false);
        }
    },


};

net.bennish.tldr.init();
