function pasteHostData(hostdata) {
    let index = hostdata.indexOf('@');
    let pubkey = hostdata.substring(0, index);
    $("#create-channel_txt_node_pubkey").val(pubkey);
    if (hostdata.includes(":")) {
        let indexColoms = hostdata.indexOf(':');
        let host = hostdata.substring(++index, indexColoms);
        let port = hostdata.substring(++indexColoms, hostdata.length);
        $("#create-channel_txt_host").val(host);
        $("#create-channel_txt_port").val(port);
    }
}
function createChannel(node_key, hostname, port, local_fund_amnt, sat_per_vbyte, min_htlc, private_channel) {

    $.ajax({
        url: "/create-channel",
        type: "POST",
        data: {
            'node_key': node_key,
            'local_fund_amnt': local_fund_amnt,
            'hostname': hostname,
            'port': port,
            'sat_per_vbyte': sat_per_vbyte,
            'min_htlc': min_htlc,
            'private': private_channel,
            'password': $("#modal-passphrase-popup_txt_password").val(),
            'passphrase': $("#modal-passphrase-popup_txt_passphrase").val()
        },
        beforeSend: function () {
            unblockArea("#passphraseModal", "");
            $("#passphraseModal").modal('hide');
            blockArea('#create-channel_div_create-channel-area', "Creating Channel...");
        },
        success: function (data) {
            Snackbar.show({
                text: "Successfully Created Channel",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            // getPendingChannels();
            unblockArea('#create-channel_div_create-channel-area', "");
        },
        error: function (data) {
            var response = JSON.parse(data['responseText']);
            Snackbar.show({
                text: response['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            unblockArea('#create-channel_div_create-channel-area', "");
        }
    });
}

function authorizeCreateChannel(pubkey, host, port, local_fund_amount, non_custodial, sat_per_vbyte, min_htlc, private_channel){
    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");

    if (non_custodial=="1"){
        //passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        $("#passphraseModal").modal('show');

        $("#modal-passphrase-popup_btn_modal-blockui").attr('onclick', 'createChannel("'+pubkey+'", "'+host+'", "'+port+'", "'+local_fund_amount+'");');

        $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
            }
        });
        $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                createChannel(pubkey, host, port, local_fund_amount, sat_per_vbyte, min_htlc, private_channel);
            }
        });
    }else{
        //no passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        $("#passphraseModal").modal('show');
        $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                    createChannel(pubkey, host, port, local_fund_amount, sat_per_vbyte, min_htlc, private_channel);
                } else {
                    $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
                }
            }
        });
        $("#modal-passphrase-popup_btn_modal-blockui").attr('onclick', 'createChannel("'+pubkey+'", "'+host+'", "'+port+'", "'+local_fund_amount+'");');
    }
}

function getTransactionFeeEstimate(){
    $.ajax({
        url: "/get-transaction-fees",
        type: "GET",
        data: {
            "json": true
        },
        success: function (data) {
            var transactionEstimate = JSON.parse(data);
            if (transactionEstimate.hasOwnProperty("transaction")){
                if (transactionEstimate['transaction'] == ""){
                    $("#create-channel_txt_sat_per_vbyte").val(1);
                }
            }else if(transactionEstimate.hasOwnProperty('transaction_med')) {
                if (JSON.parse(transactionEstimate['transaction_high']).hasOwnProperty("error")) {
                    showPopup(JSON.parse(transactionEstimate['transaction_high'])['error'], true);
                } else {
                    $("#low-priority").html(JSON.parse(transactionEstimate['transaction_low'])['sat_per_vbyte']);
                    $("#med-priority").html(JSON.parse(transactionEstimate['transaction_med'])['sat_per_vbyte']);
                    $("#high-priority").html(JSON.parse(transactionEstimate['transaction_high'])['sat_per_vbyte']);
                    $("#create-channel_txt_sat_per_vbyte").val((JSON.parse(transactionEstimate['transaction_med'])['sat_per_vbyte']));
                }
            }
        },
        error: function (data) {
            console.log(data);
            var response = JSON.parse(data['responseText']);
            Snackbar.show({
                text: response['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

$(document).ready(function () {
    getTransactionFeeEstimate();
    $(".form-control").on({
        paste(event) {
            const hostdata = event.originalEvent.clipboardData.getData('text').trim();
            if (hostdata.includes("@")) {
                event.preventDefault();
                pasteHostData(hostdata);
            }
        }
    });
    $(".clickable-link").click(function () {
        window.open($(this).attr('href'), '_blank');
    });
    $("#create-channel_btn_clear-fields").on('click', function () {
        $(".form-control").val("");
    });
    $("#passphraseModal").on('shown.bs.modal', function () {
        $('#modal-passphrase-popup_txt_password').get(0).focus();
    });
    $('#create-channel_btn_create-channel').on('click', function (event) {

        var custodial = $("#create-channel_span_node_info").data('custodial');

        var pubkey = $("#create-channel_txt_node_pubkey").val();
        if(!pubkey || pubkey.trim().length  == 0){
            showPopup("Please provide the Identity Key", true);
            return;
        }
        var local_fund_amount = $("#create-channel_txt_amount").val();
        if(!local_fund_amount || local_fund_amount.trim().length  == 0){
            showPopup("Please provide the amount", true);
            return;
        }
        var host = $("#create-channel_txt_host").val();
        var port = $("#create-channel_txt_port").val();

        var private_chan = $("#create_lnd_node_chk_private").is(":checked");
        var min_htlc = $("#create-channel_txt_min_htlc").val();
        var sat_per_vbyte = $("#create-channel_txt_sat_per_vbyte").val();

        authorizeCreateChannel(pubkey, host, port, local_fund_amount, custodial, sat_per_vbyte, min_htlc, private_chan);
    });
});
