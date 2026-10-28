Adobe's font metrics for the four faces of Times, which is what the
purchase agreement and the land lease are set in.

These are not font files -- nothing is embedded in the PDF, because Times
is one of the fourteen faces every PDF reader already has. They are the
widths, so that the line breaking and the justification in the file this
application makes are the same as a reader will lay out.

pdfkit reads them off disk in Node and out of a virtual file system in a
browser, so the browser has to be handed them. They are served rather
than bundled: a quarter of a megabyte of text has no business in a
JavaScript bundle, and these never change.

Copied from node_modules/@foliojs-fork/pdfkit/js/data.
