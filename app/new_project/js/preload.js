const { val } = require('cheerio/lib/api/attributes');
const { ipcRenderer, webFrame, webviewTag, contextBridge } = require('electron')
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
}; // Inject Jquery and Disable Links

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


function getElementByXpath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
};
