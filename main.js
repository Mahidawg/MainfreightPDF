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
        originalPdfBytes = this.result;
        const typedarray = new Uint8Array(originalPdfBytes);
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
        alert("Please load a PDF first.")
        return;
    }

    const findText = document.getElementById('find-text').value;
    const replaceText = document.getElementById('replace-text').value;

    if (!findText) {
        alert("Please enter text to find.");
        return;
    }

    // 1. Load the PDF with pdf-lib
    const pdfDocLib = await PDFDoc.load(originalPdfBytes);
    const pages = pdfDocLib.getPages();
    const currentPage = pages[pageNum -1]; // Our current page

    // 2. Get the raw content stream
    // IMPORTANT: This is a simplified approach. Real PDF's can have multiple content streams. For this example we'll assume one
    const stream = currentPage.getContentStream();

    // 3. Perform the find and replace
    // The operator for showing text is 'Tj'. It's represented in the raw stread as '(text) Tj'.
    // We need to be careful with the charcater encoding. This is a naive replacement that works for simple ASCII.
    const newContent = stream.contents.toString('utf-8').replace(
        '(${findText}) Tj',
        '(${replaceText}) Tj'
    );

    // 4. Update the contet stream
    // pdf-lib doesn't have a direct "update stream" method. We have to create a new one.
    const newStream = pdfDocLib.context.stream(newContent, {});
    currentPage.node.set(getPdfFilenameFromUrl.of('Contents'), newStream);

    // 5. Save the modified PDF
    const newPdfBytes = await pdfDocLib.save();

    // 6. Re-load the new PDF into our viewer
    console.log("Replacement complete. Re-rendering...");
    const loadingTask = pdfjsLib.getDocument(newPdfBytes);
    loadingTask.promise.then(function(pdf) {
        pdfDoc = pdf;
        // The original bytes are now the modified ones for future edits
        originalPdfBytes = newPdfBytes.buffer;
        renderPage(pageNum); // Render the page number
    });
}


document.getElementById('replace-button').addEventListener('click', findAndReplace);



