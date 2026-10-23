function setButtonState(id, text, isLoading ){
    $(id).prop('disabled', isLoading);
    $(id).html(((isLoading)?
        '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"feather feather-loader spin\">\n' +
        '<line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"6\"></line>\n' +
        '<line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"22\"></line>\n' +
        '<line x1=\"4.93\" y1=\"4.93\" x2=\"7.76\" y2=\"7.76\"></line>\n' +
        '<line x1=\"16.24\" y1=\"16.24\" x2=\"19.07\" y2=\"19.07\"></line>\n' +
        '<line x1=\"2\" y1=\"12\" x2=\"6\" y2=\"12\"></line>\n' +
        '<line x1=\"18\" y1=\"12\" x2=\"22\" y2=\"12\"></line>\n' +
        '<line x1=\"4.93\" y1=\"19.07\" x2=\"7.76\" y2=\"16.24\"></line>\n' +
        '<line x1=\"16.24\" y1=\"7.76\" x2=\"19.07\" y2=\"4.93\"></line>\n' +
        '</svg> ':'')+text);
}

//get fee estimate
function getFeeEstimate(pay_req, amt){

    $.ajax({
        url: "/get-fee-estimate",
        method: "POST",
        data: {
            "payreq": pay_req,
            "amt": amt,
            "destination": $("#send-invoice-payment_txt_amount").attr('data-destination')
        },
        beforeSend: function(){
            $("#passphraseModal").modal('hide');
            setButtonState("#create-payment_btn_submit", "Sending.....", true);
        },
        success: function (fragment){
            $("#feeEstimateModal").replaceWith(fragment);
            $("#feeEstimateModal").modal("show");
        },
        error: function ($xhr,textStatus,errorThrown){
            setButtonState("#create-payment_btn_submit", "Send Payment", false);
            let errorMessage = JSON.parse($xhr.responseText).message;
            showPopup(errorMessage, true);
        }
    });
}

//confirm gee estimate
function confirmFeeEstimate(pay_req, amount){
    var non_custodial = $("#select_node_custodial_state").val();
    var payment_type  = "LND";
    console.log(payment_type, pay_req, amount, typeof(non_custodial));
    $("#feeEstimateModal").modal("hide");
    authorizePayment(amount, pay_req, "LND", non_custodial, false);
}

//close fee estimate modal
function closeModal(){
    $("#feeEstimateModal").modal('hide');
    setButtonState("#create-payment_btn_submit", "Send Payment", false);
}

//function send payment
function sendPayment(value, address, payment_type){

    let password = $("#modal-passphrase-popup_txt_password").val();
    let passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
    var url = payment_type == "LND"?"/send-payment":"/send-btc-payment";
    var data = {};

    if (payment_type == 'LND'){
        data = {
            'pay_req': address,
            'amount': value,
            "password": password,
            "passphrase" : passphrase
        };
    }else{
        data = {
            'btc_address': address,
            'amount': value,
            "password": password,
            "passphrase" : passphrase
        };
    }
    $.ajax({
        url: url,
        type: "POST",
        data: data,
        beforeSend: function (){
            $("#passphraseModal").modal('hide');
            if(payment_type == 'LND') {
                setButtonState("#send-invoice-payment_btn_submit", "Sending.....", true);
            } else {
                setButtonState("#send-btc-payment_btn_submit", "Sending.....", true);
            }

        },
        success: function (data) {
            setButtonState("#send-invoice-payment_btn_submit", "Send Payment", false);
            setButtonState("#send-btc-payment_btn_submit", "Send Payment", false);
            showPopup("Successfully Sent "+(payment_type=="LND"?"":"BTC")+" Payment", false);
        },
        error: function ($xhr,textStatus,errorThrown) {
            let errorMessage = JSON.parse($xhr.responseText).message;
            setButtonState("#send-invoice-payment_btn_submit", "Send Payment", false);
            setButtonState("#send-btc-payment_btn_submit", "Send Payment", false);
            showPopup(errorMessage, true);
        }
    });
}

//inset payment value or unlock input if value is 0
function setAmountValue(pay_req){
    $.ajax({
        url: "/get-payment-details",
        type: "GET",
        data: {
            "pay_req": pay_req,
            "json": true
        },
        success: function (response) {
            var json = JSON.parse(response);
            console.log(json);
            //set value from payment details
            if (json.hasOwnProperty("destination")){
                $("#send-invoice-payment_txt_amount").attr('data-destination', json['destination']);
            }

            if(json.hasOwnProperty("num_satoshis")) {
                $("#send-inoice-payment_txt_amount").attr('data-value', json['num_satoshis']);
                $("#send-invoice-payment_txt_amount").attr('value', json['num_satoshis']);

                if (json['num_satoshis'] === 0 || json['num_satoshis'] == null){
                    $("#send-invoice-payment_txt_amount").prop("hidden", false);
                }else{
                    $("#send-invoice-payment_txt_amount").prop("hidden", true);
                }
            }else{
                $("#send-invoice-payment_txt_amount").prop("hidden", false);
            }
        },
        error: function ($xhr,textStatus,errorThrown) {
            let errorMessage = JSON.parse($xhr.responseText).message;
            showPopup(errorMessage, true);
        }
    });
}

function authorizePayment(value, pay_req_or_pubkey, payment_type, non_custodial, keysend){

    //initialize inputs to empty
    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");

    //if non custodial show password and passphrase inputs
    if (non_custodial=="1"){
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        $("#passphraseModal").modal('show');
    }else{
        //passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        $("#passphraseModal").modal('show');
    }

    //check if LND payment type
    if (payment_type === "LND"){
        if (keysend){
            $("#modal-passphrase-popup_btn_modal-blockui").attr('onclick', 'sendKeysendPayment("' + value + '","' + pay_req_or_pubkey + '");');
        } else {
            //passphrase needed add send payment function to button
            $("#modal-passphrase-popup_btn_modal-blockui").attr('onclick', 'sendPayment("' + value + '","' + pay_req_or_pubkey + '","' + payment_type + '");');
        }

        $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                    $("#modal-passphrase-popup_btn_modal-blockui").click();
                } else {
                    $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
                }
            }
        });

        $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                $("#modal-passphrase-popup_btn_modal-blockui").click();
            }
        });

    }else{
        //passphrase needed
        $("#modal-passphrase-popup_btn_modal-blockui").attr('onclick', 'sendPayment("'+value+'", "'+pay_req_or_pubkey+'","'+payment_type+'");');

        $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                    sendPayment(value,pay_req_or_pubkey,payment_type);
                } else {
                    $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
                }
            }
        });
        $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                sendPayment(value,pay_req_or_pubkey,payment_type);
            }
        });
    }
}

var toggleValue = '';

function confirmBTCFeeEstimate(address, amount){
    var payment_type  = "BTC";
    var non_custodial = $("#select_node_custodial_state").val();
    $("#feeEstimateModal").modal("hide");
    authorizePayment(amount, address, payment_type, non_custodial, false);
}
//get btc transaction fee estimate
function getTransactionFeeEstimate(address, amount, non_custodial){
    $.ajax({
        url: "/get-transaction-fees",
        type: "GET",
        data: {
            "address": address,
            "amount": amount,
            "json": false
        },
        success: function (data) {
            $("#feeEstimateModal").replaceWith(data);
            $("#feeEstimateModal").modal("show");
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

//send keysend payment
function sendKeysendPayment(value, address){
    let password = $("#modal-passphrase-popup_txt_password").val();
    let passphrase = $("#modal-passphrase-popup_txt_passphrase").val();

    $.ajax({
        url: "/send-keysend-payment",
        type: "POST",
        data:
            {
                "password": password,
                "passphrase": passphrase,
                "pubkey": address,
                "value": value
            },
        beforeSend: function (){
            $("#passphraseModal").modal('hide');
            setButtonState("#send-invoice-payment_btn_submit", "Sending.....", true);
        },
        success: function (data) {
            setButtonState("#send-invoice-payment_btn_submit", "Send Payment", false);
            setButtonState("#send-btc-payment_btn_submit", "Send Payment", false);
            showPopup("Successfully Sent LND Payment", false);
        },
        error: function ($xhr,textStatus,errorThrown) {
            let errorMessage = JSON.parse($xhr.responseText).message;
            setButtonState("#send-invoice-payment_btn_submit", "Send Payment", false);
            showPopup(errorMessage, true);
        }
    });
}
$(document).ready(function() {

    //focus on passphrase modal input field
    $("#passphraseModal").on('shown.bs.modal', function () {
        $('#modal-passphrase-popup_txt_password').get(0).focus();
    });

    //btc payment
    $("#send-btc-payment_btn_submit").on('click', function (){
       let amount =$("#send-btc-payment_txt_amount").val();
       let pay_req =$("#send-btc-payment_txt_request").val();
        let non_custodial = $("#select_node_custodial_state").val();
        let payment_type = "BTC";
        getTransactionFeeEstimate(pay_req, amount, non_custodial);
    });


    //get invoice amount and set in field displaying if value is 0
    $('#send-invoice-payment_txt_request').on('change', function() {
        let pay_req =$("#send-invoice-payment_txt_request").val();
        setAmountValue(pay_req);
    });

    //pay invoice
    $("#create-payment_btn_submit").on('click', function (){
        var payment_type  = $("#create-payment_slct_type").val();

        var lnd_name = $("#create-payment_slct_lnd").val();
        if(!lnd_name || lnd_name.trim().length  == 0){
            showPopup("Please Select a node", true);
            return;
        }
        var amount = $("#create-payment_txt_amount").val();

        if((!amount || amount.trim().length  == 0) && payment_type == "BTC"){
           showPopup("Please provide an amount", true);
           return;
        }
        if(amount % 1 !== 0 || amount.indexOf(".")!==-1){
            showPopup("Please provide a valid amount in Satoshi!", true);
            return;
        }
        var pay_req = $("#create-payment_txt_request").val();
        if(!pay_req || pay_req.trim().length  == 0){
            showPopup("Please provide "+ (payment_type == "LND"?"Invoice":"BTC Address"), true);
            return;
        }

        var url = payment_type == "LND"?"/send-payment":"send-btc-payment";
        var payLoad = {
            'lnd_name': lnd_name
        }
        payLoad[payment_type == "LND"?"pay_req":"btc_address"] = pay_req;

        payLoad['amount'] =  amount;
        var non_custodial = $("#select_node_custodial_state").val();
        authorizePayment(payLoad['amount'], pay_req, lnd_name, payment_type, non_custodial, false);
    });


    //click send LN invoice
    $("#send-invoice-payment_btn_submit").on('click', function(){
        let pay_req =$("#send-invoice-payment_txt_request").val();
        let non_custodial = $("#select_node_custodial_state").val();
        let amount = $("#send-invoice-payment_txt_amount").val();
        let payment_type = "LND";
        let keysend = $("#send-invoice-payment_chk_keysend").is(":checked");

        if (keysend){
            authorizePayment(amount, pay_req, "LND", non_custodial, keysend);
        }else{
            getFeeEstimate(pay_req, amount);
        }

    });

});