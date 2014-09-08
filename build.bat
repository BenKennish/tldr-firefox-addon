@echo off

echo Building tldr.xpi and tldr.update.rdf...
cfx xpi --update-link https://www.bennish.net/files/tldr.xpi --update-url https://www.bennish.net/files/tldr.update.rdf
echo Done