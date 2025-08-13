import * as pdfjsLib from './lib/pdf.mjs';

const { PDFDocument } = PDFLib;

// Set the worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.mjs';

// State variables
let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let originalPdfBytes = null;

const scale = 1.5;
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');

/**
 * Get page info from document, resize canvas accordingly, and render page.
 * @param num Page number.
 */
function renderPage(num) {
    pageRendering = true;
    // Using promise to fetch the page
    pdfDoc.getPage(num).then(function(page) {
        const viewport = page.getViewport({ scale: scale });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Render PDF page into canvas context
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        const renderTask = page.render(renderContext);

        // Wait for rendering to finish
        renderTask.promise.then(function() {
            pageRendering = false;
            if (pageNumPending !== null) {
                // New page rendering is pending
                renderPage(pageNumPending);
                pageNumPending = null;
            }
        });
    });

    // Update page counters
    document.getElementById('page-num').textContent = num;
}

/**
 * If another page rendering in progress, waits until the rendering is
 * finished. Otherwise, executes rendering immediately.
 */
function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
    } else {
        renderPage(num);
    }
}

// Event listeners
document.getElementById('prev-page').addEventListener('click', () => {
    if (pageNum <= 1) return;
    pageNum--;
    queueRenderPage(pageNum);
});

document.getElementById('next-page').addEventListener('click', () => {
    if (pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRenderPage(pageNum);
});

document.getElementById('file-input').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file.type !== 'application/pdf') {
        console.error(file.name, 'is not a PDF file.');
        return;
    }

    const fileReader = new FileReader();
    fileReader.onload = function() {
    originalPdfBytes = this.result; // Keep this original buffer safe for pdf-lib

    // 1. Create a COPY of the buffer for PDF.js to use.
    const pdfjsBuffer = originalPdfBytes.slice(0);

    // 2. Give the COPY to PDF.js. It will detach this copy, leaving our original untouched.
    const typedarray = new Uint8Array(pdfjsBuffer);
    const loadingTask = pdfjsLib.getDocument(typedarray);
    
    loadingTask.promise.then(function(pdf) {
        pdfDoc = pdf;
        document.getElementById('page-count').textContent = pdfDoc.numPages;
        pageNum = 1;
        renderPage(pageNum);
        });
    };
    fileReader.readAsArrayBuffer(file);
});

// The core editing function
async function findAndReplace() {
    if (!originalPdfBytes) {
        alert("Please load a PDF first.");
        return;
    }

    const findText = document.getElementById('find-text').value;
    const replaceText = document.getElementById('replace-text').value;

    if (!findText) {
        alert("Please enter text to find.");
        return;
    }

    try {
        const { PDFDocument, PDFArray, PDFStream, PDFName } = PDFLib;

        // 1. Load the PDF with pdf-lib
        const pdfDocLib = await PDFDocument.load(originalPdfBytes);
        const pages = pdfDocLib.getPages();
        const currentPage = pages[pageNum - 1]; // Get the current page

        // A PDF page can have one or more content streams.
        const contentStreamRef = currentPage.node.get(PDFName.of('Contents'));

        const streams = (contentStreamRef instanceof PDFArray)
            ? contentStreamRef.asArray()
            : [contentStreamRef];
        
        let allContents = '';
        const decoder = new TextDecoder('utf-8');

        streams.forEach(streamRef => {
            // Important: We need to dereference the reference to get the actual stream object
            const stream = pdfDocLib.context.lookup(streamRef);
            if (stream instanceof PDFStream) {
                allContents += decoder.decode(stream.contents);
            }
        });
        
        // 3. Perform the find and replace on the decoded string.
        const newContentString = allContents.replace(new RegExp(`\\(${findText}\\)`, 'g'), `(${replaceText})`);
        
        // 4. Encode the new string back to bytes.
        const encoder = new TextEncoder();
        const newContentBytes = encoder.encode(newContentString);

        // 5. Create a new stream and update the page's contents.
        const newStream = pdfDocLib.context.stream(newContentBytes);
        currentPage.node.set(PDFName.of('Contents'), newStream);

        // 6. Save the modified PDF
        const newPdfBytes = await pdfDocLib.save();

        // 7. Re-load the new PDF into our viewer
        console.log("Replacement complete. Re-rendering...");
        // Re-create a copy for pdf.js to use
        const pdfjsBuffer = newPdfBytes.buffer.slice(0);
        const loadingTask = pdfjsLib.getDocument(pdfjsBuffer);
        
        loadingTask.promise.then(function(pdf) {
            pdfDoc = pdf;
            // The original bytes are now the modified ones for future edits
            originalPdfBytes = newPdfBytes.buffer;
            renderPage(pageNum);
        });

    } catch (e) {
        console.error("Failed to replace text:", e);
        alert("An error occurred during the replacement process. Check the console for details.");
    }
}
    


document.getElementById('replace-button').addEventListener('click', findAndReplace);







