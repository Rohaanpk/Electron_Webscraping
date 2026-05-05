/**
 * Runs synchronously in <head> before Pico so `data-theme` matches localStorage without a flash.
 */
(function () {
    try {
        var t = localStorage.getItem('smartfox-theme');
        document.documentElement.setAttribute('data-theme', t === 'light' || t === 'dark' ? t : 'dark');
    } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
})();
