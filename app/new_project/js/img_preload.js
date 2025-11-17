// const { val } = require('cheerio/lib/api/attributes');
const { ipcRenderer, webFrame, webviewTag, contextBridge } = require('electron')

// // Load preload.js
// require('preload.js');

// Reads the xpath of an element (when function is called with the argument of the element)
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
            for (i = 1, sib = elm.previousSibling; sib; sib = sib.previousSibling) {
                if (sib.localName == elm.localName) i++;
            };
            segs.unshift(elm.localName.toLowerCase() + '[' + i + ']');
        };
    };
    return segs.length ? '/' + segs.join('/') : null;
};

// Waits for user to click on page element
document.addEventListener("click", event => {
    if (event.target.tagName === "IMG") {
        // Read Xpath and close fullscreen window if the element is an <img> (image)
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('imgXpathMain', XPath);
        ipcRenderer.send('childWindowClose');
    }
    else if (event.target.tagName === "A") {
        // Read Xpath and close fullscreen window if the element is an <a> (possible image)
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('imgXpathMain', XPath);
        ipcRenderer.send('childWindowClose');
    }
    else {
        // Show error box if an <a> or <img> are not clicked
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('wrongSearchClick', XPath);
    }
});


// PRELOAD.JS FILE CONTENTS
window.onload = function () {
    // alert("img_preload.js loaded");
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

// Apply mask to hovered element
document.addEventListener('mouseover', function (e) {
    updateMask(e.target);
});

// Update mask using mouseover event listener
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
