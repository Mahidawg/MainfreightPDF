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

// Helper function to parse the PDF content stream. This is the 'scalpel' that understands PDF syntax.
function parseContentStream(content) {
    const tokens = []
    // This regex is the core of the parser. It looks for specific PDF constructs.
    // 1. Parenthetical Strings: (\( (?:\\.|[^()])* \))
    // 2. Hexadecimal Strings: (<[A-Fa-f0-9]+>)
    // 3. Operators & Others: ([^\s()<>]+)
    const regex = /(\( (?:\\.|[^()])* \))|(<[A-Fa-f0-9]+>)|([^\s()<>]+)/g;
    let match;
    while ((match = regex.exec(contect)) !== null) {
        // match[1] is a parenthetical string, e.g., (Hello)
        // match[2] is a hex string, e.g., <48656C6C6F>
        // match[3] is an operator or value, e.g., /F1 or Tj
        tokens.push(match[0]);
    }
    return tokens;
}

// New findAndReplace Function
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
        const { PDFDocument, PDFName, PDFArray, PDFStream } = PDFLib;

        // 1. Load the PDF
        const pdfDocLib = await PDFDocument.load(originalPdfBytes);
        const pages = pdfDocLib.getPages();
        const currentPage = pages[pageNum - 1];

        // 2. Decode the content stream(s) into a single string
        const contentStreamRef = currentPage.node.get(PDFName.of('Contents'));
        const streams = (contentStreamRef instanceof PDFArray) ? contentStreamRef.asArray() : [contentStreamRef];
        let allContents = '';
        const decoder = new TextDecoder('utf-8');
        streams.forEach(streamRef => {
            const stream = pdfDocLib.context.lookup(streamRef);
            if (stream instanceof PDFStream) {
                allContents += decoder.decode(stream.contents);
            }
        });
        
        // 3. PARSE the content stream into tokens
        const tokens = parseContentStream(allContents);

        // 4. MODIFY the tokens intelligently
        // Loop through tokens to find the text to replace.
        // We look for a string literal followed by the "Tj" (Show Text) operator.
        for (let i = 0; i < tokens.length; i++) {
            // Check if the next token is 'Tj' and the current one is a string
            if (tokens[i + 1] === 'Tj' && tokens[i].startsWith('(')) {
                // Extract the text from inside the parentheses
                const currentText = tokens[i].substring(1, tokens[i].length - 1);

                if (currentText === findText) {
                    console.log(`Found and replaced "${findText}"`);
                    // Replace the token with the new text, wrapped in parentheses
                    tokens[i] = `(${replaceText})`;
                }
            }
        }

        // 5. REBUILD the content stream from the modified tokens
        const newContentString = tokens.join(' ');
        
        const encoder = new TextEncoder();
        const newContentBytes = encoder.encode(newContentString);

        // 6. Update the PDF with the new stream
        const newStream = pdfDocLib.context.stream(newContentBytes);
        currentPage.node.set(PDFName.of('Contents'), newStream);

        // 7. Save and re-render
        const newPdfBytes = await pdfDocLib.save();
        console.log("Replacement complete. Re-rendering...");
        
        const pdfjsBuffer = newPdfBytes.buffer.slice(0);
        const loadingTask = pdfjsLib.getDocument(pdfjsBuffer);
        
        loadingTask.promise.then(function(pdf) {
            pdfDoc = pdf;
            originalPdfBytes = newPdfBytes.buffer;
            renderPage(pageNum);
        });

    } catch (e) {
        console.error("Failed to replace text:", e);
        alert("An error occurred during the replacement process. Check the console for details.");
    }
}










