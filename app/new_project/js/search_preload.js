// const { val } = require('cheerio/lib/api/attributes');
const { ipcRenderer, webFrame, webviewTag, contextBridge } = require('electron') 

// Load preload.js
require('preload.js');  

// Reads the xpath of an element (when function is called with the argument of the element)
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
    console.log("test");
    if (event.target.tagName === "INPUT") {
        // Read Xpath and close fullscreen window if the element is an <input> (possible searchbox)
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('searchXpath', XPath);
        ipcRenderer.send('childWindowClose', XPath);
    }
    else {
        // Show error box if element clicked is not <input>
        var XPath = createXPathFromElement(event.target);
        ipcRenderer.send('wrongSearchClick', XPath);
        
    }
}); // Read Xpath on click


// console.log("SEARCH PRELOAD");