@echo off
rem ---- A batch file to build tldr.xpi and tldr.update.rdf

echo Building .xpi and .update.rdf files...

echo Building mobile version (skipping, disabled)
rem call cfx xpi --force-mobile --output-file=tldr-mobile.xpi --update-link https://www.bennish.net/files/tldr-mobile.xpi --update-url https://www.bennish.net/files/tldr-mobile.update.rdf
rem move tldr.update.rdf tldr-mobile.update.rdf

echo Building non-AMO desktop version...
call cfx xpi --update-link https://www.bennish.net/files/tldr.xpi --update-url https://www.bennish.net/files/tldr.update.rdf
echo Building AMO desktop version...
call cfx xpi --output-file=tldr-amo.xpi
