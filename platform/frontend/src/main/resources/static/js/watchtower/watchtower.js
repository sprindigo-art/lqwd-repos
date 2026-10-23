function getWalletBalance() {
    $.ajax({
        url: "/get-wallet-balance",
        type: "GET",
        success: function (fragment) {
            $("#wallet_balance").replaceWith(fragment);
        },
        error: function (data) {
            Snackbar.show({
                text: "Could Not Load Wallet Balance",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function createWatchtower(network, password) {
    $.ajax({
        url: "/create-watchtower",
        type: "POST",
        data: {
            'network': network,
            'password': password
        },
        beforeSend: function () {
            blockCreateArea();
        },
        success: function (data) {
            Snackbar.show({
                text: "Successfully Created Watchtower",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            unblockCreateArea();
            updateWatchtowerList();
        },
        error: function () {
            Snackbar.show({
                text: "Failed to Create Node",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            unblockCreateArea();
        }
    });
}

function blockCreateArea() {
    var block = $('#watchower-dashboard_div_create-watchtower-area');
    $(block).block({
        message: 'Creating Watchtower...' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-loader spin">' +
            '<line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line>' +
            '<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>' +
            '<line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line>' +
            '<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>' +
            '<line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>' +
            '</svg>',
        overlayCSS: {
            backgroundColor: '#000',
            opacity: 0.8,
            cursor: 'wait'
        },
        css: {
            border: 0,
            color: '#fff',
            padding: 0,
            backgroundColor: 'transparent'
        }
    });
}

function unblockCreateArea() {
    var block = $('#watchower-dashboard_div_create-watchtower-area');
    $(block).block({
        message: 'Creating Watchtower',
        timeout: 1,
        overlayCSS: {
            backgroundColor: '#000',
            opacity: 0.8,
            cursor: 'wait'
        },
        css: {
            border: 0,
            color: '#fff',
            padding: 0,
            backgroundColor: 'transparent'
        }
    });
}

$(document).ready(function () {
    getWalletBalance();
    $("#create-watchower_btn_create").on('click', function () {
        $("#lndAuthModal").modal('show');
    });

    $("#lndAuthModal-blockui").on('click', function () {
        var password = $('#lndAuthModalPassword').val();
        var network = $('#create-watchower_slct_lnd-network :selected').val();

        $("#lndAuthModal").modal('hide');
        createWatchtower(network, password);

    });

    $(".copy-hostdata").on('click', function (e) {
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

function updateWatchtowerList() {
    $.ajax({
        url: "/get-watchtowers",
        method: "GET",
        success: function (fragment) {
            $("#watchower-dashboard_div_watchtower-list").replaceWith(fragment);
            bindCopy();
        },
        error: function () {
            Snackbar.show({
                text: "Failed to Load Watchtowers",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function bindCopy() {

    $(".copy-hostdata").bind('click', function (e) {
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
}

$(".clickable-link").click(function () {
    window.open($(this).attr('href'), '_blank');
});