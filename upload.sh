#!/bin/bash

# halt on errors
set -o errexit

echo Rsyncing files to www.bennish.net/files/...
rsync -vu tldr-mobile.* ben@kennish.net:bennish/files/
echo All done
