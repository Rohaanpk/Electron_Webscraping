/**
 * Theme preference: syncs radio controls and persists `smartfox-theme` for `theme-sync.js` on load.
 */
(function () {
    var KEY = 'smartfox-theme';

    function current() {
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    }

    function apply(theme) {
        var t = theme === 'light' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', t);
        try {
            localStorage.setItem(KEY, t);
        } catch (e) { /* ignore */ }
        document.querySelectorAll('input[type="radio"][name="smartfox-theme"]').forEach(function (el) {
            el.checked = el.value === t;
        });
    }

    window.SmartfoxTheme = { apply: apply, current: current };

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('input[type="radio"][name="smartfox-theme"]').forEach(function (el) {
            el.checked = el.value === current();
            el.addEventListener('change', function () {
                if (el.checked) apply(el.value);
            });
        });
    });
})();
