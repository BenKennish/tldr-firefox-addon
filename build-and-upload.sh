#!/bin/bash

# halt on errors
set -o errexit

git diff
git commit
git push

echo Building tldr.xpi and tldr.update.rdf...
cfx xpi --update-link https://www.bennish.net/files/tldr.xpi --update-url https://www.bennish.net/files/tldr.update.rdf

echo Rsyncing files to www.bennish.net...
rsync -vu tldr.* ben@kennish.net:bennish/files/

echo All done
