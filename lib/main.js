/*
 a very rough prototype to add TLDR (Trusted Linker Download Redirect) support to Firefox
 - Ben Kennish <ben@kennish.net>
*/

try
{

    console.log("main.js starting");

    // use Cc instead of Components.classes
    // use Ci instead of Components.interfaces
    // use Cr instead of Components.results
    // use Cu instead of Components.utils
    const {Cc,Ci,Cr,Cu} = require("chrome");
    // FIXME: constants declared in global namespace


    exports.main = function(options, callbacks)
    {
        // function will be called immediately after the overall main.js is evaluated,
        // and after all top-level require() statements have run (so generally after all
        // dependent modules have been loaded)
        console.log("------------ main():", options, callbacks);
        net.bennish.tldr.init();
    }

    exports.onUnload = function(reason)
    {
        console.log("------------ onUnload():", reason);
        net.bennish.tldr.httpResponseObserver.unregister();
    }


    // create the 'namespace'
    // TODO: perhaps I could use this instead:
    // https://developer.mozilla.org/en-US/Add-ons/SDK/Low-Level_APIs/core_namespace
    if (!net) var net = {};
    if (!net.bennish) net.bennish = {};

    net.bennish.tldr =
    {
        // these should be constants but are actually variables
        HEADER_NAME_CHECKSUM_SHA1: 'Location-Checksum-SHA1',

        HTTP_RESPONSE_CODES_TO_LISTEN_FOR: [302, 303, 307],
        // TLDR should be used with all forms of temporary redirect:
        // 302 Found, 303 See Other (HTTP/1.1), and 307 Temporary Redirect (HTTP/1.1),

        PAUSE_BEFORE_DELETE_BAD_DOWNLOAD_MS: 10000,
        //TODO: we should just delete when the file is no longer locked, not wait and then try just once

        // an "associative array object" to store our hashes and stuff in
        // between the redirect and the start of the download
        links: {},

        init: function()
        {

            //console.log("widgetToolkit:", Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULRuntime).widgetToolkit);

            var currentLogLevel = require("sdk/preferences/service").get("extensions.tldr@bennish.net.sdk.console.logLevel");

            // we want console.warn() to be visible too (default is console.error only)
            if (currentLogLevel == 'error')
                require("sdk/preferences/service").set("extensions.tldr@bennish.net.sdk.console.logLevel", "warn");

            this.httpResponseObserver.register();

            Cu.import("resource://gre/modules/Task.jsm");

            Task.spawn(function ()
            {
                console.log("***** Task.spawn started");

                // used for download manager stuff
                try
                {
                    Cu.import("resource://gre/modules/Downloads.jsm");
                }
                catch (e)
                {
                    console.error(e);
                }
                // i think this might be failing on Android

                //Cu.import("resource://gre/modules/FileUtils.jsm");

                console.log("***** About to set list");

                /*
                let:
                 allows you to declare variables, limiting its scope to the block, statement, or expression
                 on which it is used. This is unlike the var keyword, which defines a variable globally, or locally
                 to an entire function regardless of block scope

                yield: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/yield

                The yield keyword causes generator function execution to pause and return the current value of the expression following the yield keyword. It can be thought of as a generator-based version of the return keyword.

                The yield keyword actually returns an object with two paramters, value and done. value is the result of evaluating the yield expression, and done is a bool indicating whether or not the generator function has fully completed.

                Once paused on a yield statement, code execution for the generator cannot resume unless invoked externally by calling the generator's next() method. This allows for direct control of the generator's execution and incremental return values.

                Downloads.getList .. a promise to return a DownloadList

                */

                // yield causes the Task to block until the Promise returns
                // FIXME: this line is failing on Android
                let list = yield Downloads.getList(Downloads.ALL);

                console.log("***** list set!");

                let view =
                {
                    onDownloadAdded: download =>
                    {
                        console.log("Download Added:", download);

                        let link;

                        // first see if the referrer to the download URL is in our links object
                        if (download.source.referrer && net.bennish.tldr.links[download.source.referrer])
                        {
                            link = download.source.referrer;
                        }
                        // if not, try the source URL itself (unlikely to work)
                        else if (net.bennish.tldr.links[download.source.url])
                        {
                            link = download.source.url;
                        }

                        if (link && net.bennish.tldr.links[link])
                        {
                            // show a notification?

                            // move the data from the tldr.links object to the download object
                            download.tldr = net.bennish.tldr.links[link];
                            delete net.bennish.tldr.links[link];
                            console.log("Purged "+link+" from links object.  It now looks like this:", net.bennish.tldr.links);
                            console.log('----------------');
                        }
                    },

                    onDownloadChanged: download =>
                    {

                        if (download.succeeded && download.stopped && download.tldr)
                        {
                            console.log("A TLDR download just completed:", download);

                            console.log("Source:", download.source.url);
                            console.log("Referrer:", download.source.referrer);
                            console.log("Target:", download.target.path);

                            // TODO: is this property correct? can we use and rely on it?
                            /*
                            var sha256 = download.saver._sha256Hash;
                            console.log("SHA256 hash?", sha256);
                            */

                            console.log("SHA1 from HTTP Header:", download.tldr.sha1);

                            console.time('computeSHA1');
                            var sha1 = net.bennish.tldr.computeSHA1(download.target.path);
                            console.timeEnd('computeSHA1');

                            console.log("SHA1 calculated result: ", sha1);

                            const fileIO = require("sdk/io/file");

                            var filename = fileIO.basename(download.target.path);
                            var trustedHost = download.tldr.trustedLinker.host;
                            var notifications = require("sdk/notifications");

                            if (sha1 == download.tldr.sha1)
                            {
                                console.log("SUCCESS! It matched the header!");

                                if (require('sdk/simple-prefs').prefs['showNotificationOnValidate'])
                                {
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

                                // this creation of 2 new vars is necessary as the panel.on('show') function cannot read tldr[link]
                                var trustedLinker = download.tldr.trustedLinker.spec;
                                var trustedLinkerReferrer = download.tldr.trustedLinkerReferrer;

                                //TODO: this should be a permanent notification, not a temporary one
                                notifications.notify(
                                {
                                    title: filename,
                                    text: "Verification from "+trustedHost+" failed\nDownloaded file removed", //+" using TLDR",
                                    iconURL: require("sdk/self").data.url('tldr-icon-error-64x64.png'),
                                    data: undefined,// some data here?
                                    onClick: function(data)
                                    {
                                        // TODO: show some more info to the user?
                                    }
                                });

                                // old method - showing a Panel on mismatch....
                                /*
                                var appData = require("sdk/self").data;

                                // show error message to user in a panel
                                var panel = require("sdk/panel").Panel(
                                {
                                    width: 750,
                                    contentURL: appData.url("checksumMismatchPanel.html"),
                                    contentScriptFile: appData.url("checksumMismatchPanel.js"),
                                    position: { top: 40 },
                                    //focus: false, // accessibility issue?
                                });

                                panel.on('show', function()
                                {
                                    panel.port.emit("showPanel", download.source.url, download.target.path, trustedLinker, trustedLinkerReferrer);
                                });

                                panel.show();
                                */

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
                                    // TODO: try again later?  or create an observer for file lock state change
                                }
                            }

                        }
                    },

                    onDownloadRemoved: download =>
                    {
                        //console.log("Download Removed", download)
                    }
                };

                // yield causes this Promise to return the result
                yield list.addView(view);

                console.log("Task.spawn complete");

            }).then(function() { console.log("*** Task to register downloads complete"); }, Cu.reportError);
            // on fulfill, do nothing, on error report it

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


                console.log('Received a TLDR header during an HTTP '+channel.responseStatus+' response');
                console.log(net.bennish.tldr.HEADER_NAME_CHECKSUM_SHA1+':', sha1);

                console.log("Referer:", referrer);
                console.log('Current URI:', channel.URI.spec);
                console.log('Location:', link);

                if (channel.URI.scheme != 'https')
                {
                    if (require('sdk/simple-prefs').prefs['requireHTTPS'])
                    {
                        console.error(channel.URI.spec+' tried to use TLDR but requireHTTPS is true');
                        return;
                    }
                    else
                    {
                        console.warn(channel.URI.spec+' is using TLDR without HTTPS (almost pointless)');
                    }
                }

                if (channel.URI.spec != channel.originalURI.spec)
                {
                    // someone has redirected to the trusted linker
                    console.warn(channel.URI.spec+" is using TLDR for an HTTP request but it isn't the first in a chain of redirects");
                }

                // TODO
                // channel.notificationCallbacks = ....

                net.bennish.tldr.links[link] =
                {
                    trustedLinkerReferrer: referrer,
                    trustedLinker: channel.URI,
                    trustedLink: link,
                    sha1: sha1,
                };

                //TODO: we should latch onto this chain of HTTP connections until it
                // gets to a download /page and then attach the data to the download object
                // or delete the object from tldr.links[] if it doesn't

                console.log('----- Finished observing HTTP response -----');

            },

            // defines a lazy getter for a field
            get observerService()
            {
                return Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
            },

            register: function()
            {
                console.log("Registering HTTP observer..");
                this.observerService.addObserver(this, 'http-on-examine-response', false);
                this.observerService.addObserver(this, 'http-on-examine-cached-response', false);
                console.log("Done registering HTTP observer");
            },

            unregister: function()
            {
                console.log("Unregistering HTTP observer..");
                this.observerService.removeObserver(this, 'http-on-examine-response', false);
                this.observerService.removeObserver(this, 'http-on-examine-cached-response', false);
                console.log("Done unregistering HTTP observer");
            }
        },


    };

    console.log("main.js complete");
}
catch (e)
{
    console.log("net.bennish.tldr generated an exception:", e);
}
