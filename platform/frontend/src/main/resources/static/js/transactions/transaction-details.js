function updateTransactionSelectList(lnd_name, tx_hash){

    $.get("/get-transactions?lnd_name="+lnd_name).done(function (jsonArray){
        document.getElementById("transaction-details_slct_transaction-select").options.length = 0;

        $('#transaction-details_slct_transaction-select').append($('<option/>', {
            value: "",
            text: "Select Transaction"
        }));

        $.each(JSON.parse(jsonArray), function (index, value){
            if (tx_hash != null){
                if (value['tx_hash'] == tx_hash) {
                    $('#transaction-details_slct_transaction-select').append($('<option/>', {
                        value: value['tx_hash'],
                        text: value['tx_hash'],
                        selected: true
                    }));
                }else{
                    $('#transaction-details_slct_transaction-select').append($('<option/>', {
                        value: value['tx_hash'],
                        text: value['tx_hash']
                    }));
                }
            }
            $('#transaction-details_slct_transaction-select').append($('<option/>', {
                value: value['tx_hash'],
                text: value['tx_hash'],
            }));

        });
    });
}

function getTransactionDetails(lnd_name, transaction) {
    $.get("/get-transaction-details?lnd_name=" + lnd_name + "&tx_hash=" + transaction).done(function (fragment) {
        $("#transaction-details_div_transaction-detail-content").replaceWith(fragment);
    });
}

function copyToClipboard(value) {
    console.log("hello +" + value);
    try {
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
}

$(document).ready(function () {
    $('#transaction-details_slct_lnd-select').on('change', function () {
        var lnd_name = $("#transaction-details_slct_lnd-select :selected").attr('value');
        updateTransactionSelectList(lnd_name);
    });

    $('#transaction-details_slct_transaction-select').on('change', function () {
        var transaction_hash = $("#transaction-details_slct_transaction-select :selected").attr('value');
        var lnd_name = $("#transaction-details_slct_lnd-select :selected").attr('value');
        getTransactionDetails(lnd_name, transaction_hash);
    });
});
$(".clickable-link").click(function () {
    window.open($(this).attr('href'), '_blank');
});