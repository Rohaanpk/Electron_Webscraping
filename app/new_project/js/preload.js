const { val } = require('cheerio/lib/api/attributes');
const { ipcRenderer, webFrame } = require('electron')
const xPathToCss = require('xpath-to-css')

window.onload = function() {
    webFrame.setZoomFactor(1);
    console.log('preload.js loaded');
    var scriptElt = document.createElement('script');
    scriptElt.type = 'text/javascript';
    scriptElt.src = "https://code.jquery.com/jquery-3.6.0.min.js";
    document.getElementsByTagName('head')[0].appendChild(scriptElt);

    console.log("Disable?");
    $( "a" ).attr("disabled", "disabled");
    $( "img" ).attr("disabled", "disabled"); 
    console.log("Disabled");

    $("*").on("click", function(event){
        if ($(this).is("[disabled]")) {
            event.preventDefault();
        }
    });
}; // Inject Js and Disable Links

ipcRenderer.on('sendbackhtml', (event, arg) => {
    console.log('preload: received sendbackhtml')
    ipcRenderer.send('hereishtml', document.documentElement.innerHTML)
  })


document.addEventListener('mouseover', function (e) {
    updateMask(e.target);
}); // Apply mask to hovered element


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
}; // Update mask


window.addEventListener("click", a => {
    var value = createXPathFromElement(a.target);
    console.log(value);
    console.log(a); 
    window.localStorage.my_testing_var = value;
    var css = xPathToCss(value);
    console.log(css);
    var element = document.querySelector(css);
    console.log(element.textContent);
    var text = element.textContent;
    console.log(element.href);
    console.log(element.src);
    ipcRenderer.send('asynchronous-message', value);
    ipcRenderer.send('asynchronous-message', text);
    // window.close();
}); // Read Xpath on click


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


const keys = { "F1": false, "F2": false, "F3": false, "F4": false, "F5": false, "F6": false, "F7": false, "F8": false, "F9": false, "F10": false, "F11": false, "F12": false, "F13": false, "F14": false, "F15": false, "F16": false, "F17": false, "F18": false, "F19": false, "F20": false, "F21": false, "F22": false, "F23": false, "F24": false, "PrintScreen": false, "ScrollLock": false, "Pause": false, "Tab": false, "CapsLock": false, "Shift": false, "Control": false, "Meta": false, "Alt": false, "ContextMenu": false, "ArrowLeft": false, "ArrowRight": false, "ArrowUp": false, "ArrowDown": false, "Enter": false, "Backspace": false, "Clear": false, "NumLock": false, "Insert": false, "Home": false, "PageUp": false, "PageDown": false, "End": false, "Delete": false }
document.addEventListener('keydown', function (event) {
  if (event.defaultPrevented) {
    return
  }
  return checkKey(event)
})
function checkKey(event) { // block keyboard events such as alt-f4 which could close the window
  let key = event.key || event.keyCode;
  let val = parseInt(key, 10);
  if (typeof val == 'number' ||
    keys[key] == false ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.metaKey ||
    event.repeat) {
    event.preventDefault()
    return false
  }
}

// // Synchronous message emmiter and handler
// console.log(ipcRenderer.sendSync('synchronous-message', 'sync ping')) 

// Async message handler
ipcRenderer.on('asynchronous-reply', (event, arg) => {
   console.log(arg)
})
