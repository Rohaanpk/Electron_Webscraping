/**
 * Opens/closes the shared settings `<dialog>` (gear button in the corner).
 */
(function () {
    document.addEventListener("DOMContentLoaded", function () {
        var dialog = document.getElementById("app_settings_modal");
        var openBtn = document.querySelector(".app-settings-trigger");
        if (!dialog || !openBtn) return;

        var closeBtn = dialog.querySelector(".app-settings-modal__close");

        function openModal() {
            if (typeof dialog.showModal === "function") {
                dialog.showModal();
            } else {
                dialog.setAttribute("open", "");
            }
            if (window.SmartfoxTheme && typeof window.SmartfoxTheme.apply === "function") {
                window.SmartfoxTheme.apply(window.SmartfoxTheme.current());
            }
        }

        function closeModal() {
            if (typeof dialog.close === "function") {
                dialog.close();
            } else {
                dialog.removeAttribute("open");
            }
        }

        openBtn.addEventListener("click", function () {
            openModal();
        });

        if (closeBtn) {
            closeBtn.addEventListener("click", function () {
                closeModal();
            });
        }

        dialog.addEventListener("click", function (e) {
            if (e.target === dialog) {
                closeModal();
            }
        });

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && dialog.open) {
                closeModal();
            }
        });
    });
})();
