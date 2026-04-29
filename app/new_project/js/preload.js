const { webFrame, ipcRenderer} = require('electron')

let XPath = ""
let lastRightClickedElement = null;

/**
 * Builds an XPath string for a DOM element.
 *
 * Notes:
 * - Prefers a unique `id("...")` segment when possible.
 * - Otherwise builds a positional XPath using sibling indices.
 *
 * @param {Element} elm DOM element to describe.
 * @returns {string|null} XPath expression, or null if not computable.
 */
function createXPathFromElement(elm) {
    var allNodes = document.getElementsByTagName('*');
    for (var segs = []; elm && elm.nodeType == 1; elm = elm.parentNode) {
        if (elm.hasAttribute('id')) {
            var uniqueIdCount = 0;
            for (var n = 0; n < allNodes.length; n++) {
                if (allNodes[n].hasAttribute('id') && allNodes[n].id == elm.id) uniqueIdCount++;
                if (uniqueIdCount > 1) break;
            };
            if (uniqueIdCount == 1) {
                segs.unshift('id("' + elm.getAttribute('id') + '")');
                return segs.join('/');
            }
        }
        else {
            var i, sib;
            for (i = 1, sib = elm.previousSibling; sib; sib = sib.previousSibling) {
                if (sib.localName == elm.localName) i++;
            };
            segs.unshift(elm.localName.toLowerCase() + '[' + i + ']');
        };
    };
    return segs.length ? '/' + segs.join('/') : null;
};

document.addEventListener("contextmenu", event => {
    // console.log(event)
    lastRightClickedElement = event.target;
    // Electron IPC:
    // Ask the main process to show a native context menu for this webContents.
    // If the user chooses "Get XPath", main will send back `get-xpath`.
    ipcRenderer.send('show-ctxmenu');
    // event.preventDefault();

    // event.preventDefault()
    // rightClickPosition = {x: event.x, y: event.y}
    // menu.popup(remote.getCurrentWindow())

    // XPath = createXPathFromElement(event.target);
    // console.log(XPath);
    // ipcRenderer.send('storeXpath', XPath)

    // ipcRenderer.send('linkXpathMain', XPath);
    // ipcRenderer.send('childWindowClose', XPath);
}); 

/**
 * IPC: main process requests that we compute an XPath for the last right-clicked element.
 * This is used by the native context menu flow: right click → menu → "Get XPath".
 *
 * @listens ipcRenderer#get-xpath
 * @returns {void}
 */
ipcRenderer.on('get-xpath', () => {
    if (!lastRightClickedElement) return;
    XPath = createXPathFromElement(lastRightClickedElement);
    ipcRenderer.send('storeXpath', XPath);
})




// PRELOAD.JS FILE CONTENTS
window.onload = function () {
    // alert("search_preload.js loaded");
    webFrame.setZoomFactor(1);
    console.log('preload.js loaded');
    var scriptElt = document.createElement('script');
    scriptElt.type = 'text/javascript';
    scriptElt.src = "https://code.jquery.com/jquery-3.6.0.min.js";
    document.getElementsByTagName('head')[0].appendChild(scriptElt);

    // Disable Links
    $("*").on("click", function (event) {
        if ($(this).is("[disabled]")) {
            event.preventDefault();
        }
    });
};

/**
 * Tracks hover movement and updates a visual overlay to highlight the element under the cursor.
 *
 * @param {MouseEvent} e
 * @returns {void}
 */
document.addEventListener('mouseover', function (e) {
    updateMask(e.target);
});

/**
 * Draws/updates an absolutely-positioned overlay matching the target element's bounding box.
 *
 * @param {Element} target DOM element to highlight.
 * @returns {void}
 */
function updateMask(target) {
    let elements = document.getElementsByClassName("highlight-wrap")
    let hObj
    if (elements.length !== 0) {
        hObj = elements[0]
    } else {
        hObj = document.createElement("div");
        hObj.className = 'highlight-wrap';
        hObj.style.position = 'absolute';
        hObj.style.backgroundColor = '#A020F0';
        hObj.style.opacity = '0.5';
        hObj.style.cursor = 'default';
        hObj.style.pointerEvents = 'none';
        document.body.appendChild(hObj);
    }
    let rect = target.getBoundingClientRect();
    hObj.style.left = (rect.left + window.scrollX) + "px";
    hObj.style.top = (rect.top + window.scrollY) + "px";
    hObj.style.width = rect.width + "px";
    hObj.style.height = rect.height + "px";
};
