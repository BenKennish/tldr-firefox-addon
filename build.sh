#!/bin/bash

echo Building tldr.xpi and tldr.update.rdf...
echo Mobile:
cfx xpi --force-mobile --output-file=tldr-mobile.xpi --update-link https://www.bennish.net/files/tldr-mobile.xpi --update-url https://www.bennish.net/files/tldr-mobile.update.rdf
mv -f tldr.update.rdf tldr-mobile.update.rdf
echo Desktop:
cfx xpi --update-link https://www.bennish.net/files/tldr.xpi --update-url https://www.bennish.net/files/tldr.update.rdf
echo Done
