/*
 a very rough prototype to add TLDR (Trusted Linker Download Redirect) support to Firefox
 - Ben Kennish <ben@kennish.net>
 */

if (!net) var net = {};
if (!net.bennish) net.bennish = {};

// use Cc instead of Components.classes
// use Ci instead of Components.interfaces
// use Cr instead of Components.results
// use Cu instead of Components.utils
const {Cc,Ci,Cr,Cu} = require("chrome");

net.bennish.tldr =
{
    // these should be constants but are actually vars
    HEADER_NAME_CHECKSUM_SHA1: 'TLDR-Checksum-SHA1',
    HTTP_RESPONSE_CODE_FOUND: 302,
    PAUSE_BEFORE_DELETE_BAD_DOWNLOAD_MS: 10000,
    //TODO: we should just delete when we can, not wait some time and then try once

    // an "associative array object" to store our hashes and stuff in
    data: {},

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
                        if (download.source.referrer && net.bennish.tldr.data[download.source.referrer])
                        {
                            link = download.source.referrer;
                        }
                        else if (net.bennish.tldr.data[download.source.url])
                        {
                            link = download.source.url;
                        }

                        if (link && net.bennish.tldr.data[link])
                        {
                            console.log("SHA1 from HTTP Header:", net.bennish.tldr.data[link].sha1);

                            console.time('computeSHA1');
                            var sha1 = net.bennish.tldr.computeSHA1(download.target.path);
                            console.timeEnd('computeSHA1');

                            console.log("SHA1 calculated result: ", sha1);

                            if (sha1 == net.bennish.tldr.data[link].sha1)
                            {
                                console.log("SUCCESS! It matched the header!");

                                if (require('sdk/simple-prefs').prefs['showNotificationOnValidate'])
                                {
                                    var notifications = require("sdk/notifications");
                                    notifications.notify(
                                    {
                                        title: "Download verified using TLDR",
                                        text: download.target.path+" downloaded and checksum verified",
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

                                // show error message to user in a panel
                                var panel = require("sdk/panel").Panel(
                                {
                                    width: 600,
                                    contentURL: appData.url("checksumMismatchPanel.html"),
                                    contentScriptFile: appData.url("checksumMismatchPanel.js"),
                                    position: { top: 40 },
                                    focus: false, // accessibility issue?
                                });

                                console.log("panel created. About to use panel.on(). Here is tldr[link]", net.bennish.tldr.data[link]);

                                // this is necessary as the panel.on('show') function cannot read tldr[link]
                                var trustedLinker = net.bennish.tldr.data[link].trustedLinker;
                                var trustedLinkerReferrer = net.bennish.tldr.data[link].trustedLinkerReferrer;

                                panel.on('show', function()
                                {
                                    panel.port.emit("showPanel", download.source.url, download.target.path, trustedLinker, trustedLinkerReferrer);
                                });

                                panel.show();


                                const fileIO = require("sdk/io/file");
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
                            delete net.bennish.tldr.data[link];
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
            if (channel.responseStatus != net.bennish.tldr.HTTP_RESPONSE_CODE_FOUND) return;

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


            console.log('Received a TLDR header during an '+net.bennish.tldr.HTTP_RESPONSE_CODE_FOUND+' HTTP response');
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

            net.bennish.tldr.data[link] =
            {
                trustedLinkerReferrer: referrer,
                trustedLinker: channel.URI.spec,
                sha1: sha1,
            };

            //TODO: rather that using this primitive method of matching a download to its entry
            // in the tldr object, we should latch onto this chain of HTTP connections until it
            // gets to a download and then attach the data to the download
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









    // -----------------------------------------------------------
    // add in an HTTP header for sites with "bennish.net" within host
    /*
    observerService.addObserver(
    {
        observe : function(subject, topic, data)
        {
            var channel = subject.QueryInterface(Ci.nsIHttpChannel);
            if (/bennish\.net/.test(channel.originalURI.host))
            {
                channel.setRequestHeader("X-Bennish-Is-Cool", "true", false);
            }
        }
    }, "http-on-modify-request", false);



    // Helper function for XPCOM instanciation (from Firebug)
    function CCIN(cName, ifaceName)
    {
        return Cc[cName].createInstance(Ci[ifaceName]);
    }


    function TracingListener()
    {
        this.originalListener = null;
        this.receivedData = []; // array for incoming data
    }


    TracingListener.prototype =
    {
        onDataAvailable: function(request, context, inputStream, offset, count)
        {
            //this.originalListener.onDataAvailable(request, context, inputStream, offset, count);

            var binaryInputStream = CCIN("@mozilla.org/binaryinputstream;1", "nsIBinaryInputStream");
            var storageStream = CCIN("@mozilla.org/storagestream;1", "nsIStorageStream");
            var binaryOutputStream = CCIN("@mozilla.org/binaryoutputstream;1", "nsIBinaryOutputStream");

            binaryInputStream.setInputStream(inputStream);
            storageStream.init(8192, count, null);
            binaryOutputStream.setOutputStream(storageStream.getOutputStream(0));

            // Copy received data as they come.
            var data = binaryInputStream.readBytes(count);
            this.receivedData.push(data);

            binaryOutputStream.writeBytes(data, count);

            this.originalListener.onDataAvailable(request, context, storageStream.newInputStream(0), offset, count);

        },

        onStartRequest: function(request, context)
        {
            this.originalListener.onStartRequest(request, context);
        },

        onStopRequest: function(request, context, statusCode)
        {
            //this.originalListener.onStopRequest(request, context, statusCode);

            // Get entire response

            var responseSource = this.receivedData.join();
            // this seems to have the whole HTTP body response.  but we want the headers!!
            //console.log('responseSource', responseSource);

            this.originalListener.onStopRequest(request, context, statusCode);
        },

        QueryInterface: function (aIID)
        {
            if (aIID.equals(Ci.nsIStreamListener) || aIID.equals(Ci.nsISupports))
            {
                return this;
            }
            throw Cr.NS_NOINTERFACE;
        }
    }


    // --------------

    var httpRequestObserver =
    {
        observe: function(aSubject, aTopic, aData)
        {
            if (aTopic == "http-on-examine-response")
            {
                var newListener = new TracingListener();
                aSubject.QueryInterface(Ci.nsITraceableChannel);
                newListener.originalListener = aSubject.setNewListener(newListener);
            }
        },

        QueryInterface : function (aIID)
        {
            if (aIID.equals(Ci.nsIObserver) || aIID.equals(Ci.nsISupports))
            {
                return this;
            }

            throw Cr.NS_NOINTERFACE;

        }
    };


    //const Cc = Components.classes;
    //const Ci = Components.interfaces;

    var observerService = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);

    observerService.addObserver(httpRequestObserver, "http-on-examine-response", false);

    // when should this be run?
    //observerService.removeObserver(httpRequestObserver, "http-on-examine-response");

    */


    // -----------------------------------------------------------
    // When a tab loads, show the title and URL into the console

    /*
    var tabs = require("sdk/tabs");

    // this doesn't work for downloaded files
    tabs.on('ready',
        function(tab)
        {
            console.log('--- A tab has just loaded ---');
            console.log('Title:',tab.title);
            console.log('URL:',tab.url);
            console.log('--------------');
        }
    );
    */

    // add listeners to the download manager
    // nsIDownloadManager no longer available since Firefox 26
    /*
    var dm = Cc["@mozilla.org/download-manager;1"].getService(Ci.nsIDownloadManager);

    dm.addListener(
    {
        onSecurityChange : function(prog, req, state, dl) { },
        onProgressChange : function(prog, req, prog2, progMax, tProg, tProgMax, dl) { },
        onStateChange : function(prog, req, flags, status, dl) { },
        onDownloadStateChange : function(state, dl)
        {
            console.log("Download state changed to ", state, )
        }
    });
    */

};

net.bennish.tldr.init();