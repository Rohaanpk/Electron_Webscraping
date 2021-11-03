const { val } = require('cheerio/lib/api/attributes');
const { ipcRenderer, webFrame, webviewTag, contextBridge } = require('electron')

require('./preload.js');  

function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
};

function createXPathFromElement(elm) { 
    var allNodes = document.getElementsByTagName('*'); 
    for (var segs = []; elm && elm.nodeType == 1; elm = elm.parentNode) 
    { 
        if (elm.hasAttribute('id')) { 
            var uniqueIdCount = 0; 
            for (var n=0;n < allNodes.length;n++) { 
                if (allNodes[n].hasAttribute('id') && allNodes[n].id == elm.id) uniqueIdCount++; 
                if (uniqueIdCount > 1) break; 
            }; 
            if ( uniqueIdCount == 1) { 
                segs.unshift('id("' + elm.getAttribute('id') + '")'); 
                return segs.join('/'); 
            }
        }
        else { 
            for (i = 1, sib = elm.previousSibling; sib; sib = sib.previousSibling) { 
                if (sib.localName == elm.localName)  i++; }; 
                segs.unshift(elm.localName.toLowerCase() + '[' + i + ']'); 
        }; 
    }; 
    return segs.length ? '/' + segs.join('/') : null; 
};

document.addEventListener("click", event => {
    if (event.target.tagName === "IMG") {
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('imgXpathMain', XPath);
        ipcRenderer.send('childWindowClose');
    }
    else if (event.target.tagName === "A") {
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('imgXpathMain', XPath);
        ipcRenderer.send('childWindowClose');
    }
    else {
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('no-searchclick', XPath);
    }
}); // Read Xpath on click
