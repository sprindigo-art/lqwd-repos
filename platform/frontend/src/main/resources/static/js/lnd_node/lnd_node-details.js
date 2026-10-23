$(document).ready(function () {
    $(".copy-icons").on('click', function (e) {
        e.preventDefault();
        try {
            var value = $(this).data('value');
            navigator.clipboard.writeText(value);

            Snackbar.show({
                text: "Successfully Copied to Clipboard",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
        } catch (err) {
            Snackbar.show({
                text: "Failed to Copy to Clipboard",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
});

$(".clickable-link").click(function () {
    window.open($(this).attr('href'), '_blank');
});