self.port.on('showPanel', function onShowPanel(downloadSourceURL, localFilename, trustedLinker, trustedLinkerReferrer)
{
    document.getElementById('downloadSourceURL').innerHTML = downloadSourceURL;
    document.getElementById('localFilename').innerHTML = localFilename;
    document.getElementById('trustedLinker').innerHTML = trustedLinker;
    document.getElementById('trustedLinkerReferrer').innerHTML = trustedLinkerReferrer;
})
