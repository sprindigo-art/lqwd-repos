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
//open payment lookup
function openPaymentLookup(pay_req){
    $.ajax({
        url: "/get-fee-estimate",
        type: "POST",
        data: {
            "pay_req": pay_req
        },
        beforeSend: function(){
            $("#send-invoice-payment_div_payment-lookup-card").attr("placeholder", "Loading Payment Information...");
        },
        success: function (data) {
            $("#send-invoice-payment_div_payment-lookup-card").replaceWith(data);
            $("#send-btc-payment_div_send-request").css("position", "absolute");
            $("#send-btc-payment_div_send-request").css("bottom", "18px");
            $("#send-btc-payment_div_send-request").css("width", "100%");
            $("#send-invoice-payment_div_send-request").css("width", "100%");
        },
        error: function ($xhr,textStatus,errorThrown) {
            showPopup("Failed to open payment details", true);
        }
    });
}
//load transactions
function getTransactions() {
    $.ajax({
        url: "/get-transactions-frag",
        method: "GET",
        beforeSend: function (){
            blockArea("#transactions-container", "Loading Transactions...");
        },
        success: function (fragment) {
            unblockArea("#transactions-container", "");
            $("#transactions").replaceWith(fragment);
        },
        error: function (){
            unblockArea("#transactions-container", "");
            showPopup("Failed to Load Transactions", true);
        }
    });
}

//load payments
function getPaymentList(){
    $.ajax({
        url: "/get-payments",
        method: "GET",
        beforeSend: function (){
            blockArea("#payments-container", "Loading Payments...");
        },
        success: function (fragment){
            unblockArea("#payments-container", "");
            $("#payment-list").replaceWith(fragment);
        },
        error: function (response){
            unblockArea("#payments-container", "");
            var error = JSON.parse(response['responseText']);
            showPopup(error, true);
        }
    });
}

//open transaction window
function openTransaction(tx_hash, lnd_name){
    window.open('/transactions?tx_hash='+tx_hash+'&lnd_name='+lnd_name, '_self');
}


//get fee estimate
function getFeeEstimate(pay_req, pubkey, amt, lnd_name){
    $.ajax({
        url: "/get-fee-estimate",
        method: "POST",
        data: {
            "payreq": pay_req,
            "pubkey": pubkey,
            "amt": amt,
            "lnd_name": lnd_name,
            "password": $("#modal-passphrase-popup_txt_password").val()
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

function confirmFeeEstimate(lnd_name, pay_req, amount){
    var payment_type  = "LND";
    console.log(lnd_name, payment_type, pay_req, amount);
    $("#feeEstimateModal").modal("hide");
    sendPayment(amount, pay_req, lnd_name, payment_type);
}

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
            getTransactions();
            getPaymentList();
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
            //set value from payment details
            if(json.hasOwnProperty("num_satoshis")) {
                $("#send-invoice-payment_txt_amount").val(parseInt(json['num_satoshis']));
            }
        },
        error: function ($xhr,textStatus,errorThrown) {
            let errorMessage = JSON.parse($xhr.responseText).message;
            showPopup(errorMessage, true);
        }
    });
}

function authorizePayment(value, pay_req_or_pubkey, payment_type, non_custodial){
    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");
    if (non_custodial=="1"){
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        $("#passphraseModal").modal('show');

    }else{
        //no passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        $("#passphraseModal").modal('show');
    }

    if (payment_type === "LND"){
        //passphrase needed
        $("#modal-passphrase-popup_btn_modal-blockui").attr('onclick', 'sendPayment("'+value+'","'+pay_req_or_pubkey+'","'+payment_type+'");');
        $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                    sendPayment(value, pay_req_or_pubkey, payment_type);
                } else {
                    $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
                }
            }
        });
        $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                sendPayment(value, pay_req_or_pubkey, payment_type);
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

$(document).ready(function() {
    getPaymentList();

    $('#create-payment_slct_type').on('change', function() {

        if( this.value  == "LND"){
            $("#create-payment_txt_request").attr("placeholder", "Payment Request");
            var currentVal = $("#create-payment_txt_request").val();
            $("#create-payment_txt_request").val(toggleValue)
            toggleValue = currentVal;
            $("#create-payment_txt_amount").prop('disabled', true);
        }else if( this.value  == "BTC"){
            var currentVal = $("#create-payment_txt_request").val();
            $("#create-payment_txt_request").attr("placeholder", "BTC Address");
            $("#create-payment_txt_request").val(toggleValue)
            toggleValue = currentVal;
            $("#create-payment_txt_amount").prop('disabled', false);
        }
    });
    $("#passphraseModal").on('shown.bs.modal', function () {
        $('#modal-passphrase-popup_txt_password').get(0).focus();
    });

    $("#send-invoice-payment_h5_review_details").on("click", function (){
        var pay_req = $("#send-invoice-payment_txt_request").val();
        setAmountValue(pay_req);
        openPaymentLookup(pay_req);

    });
//btc payment
    $("#send-btc-payment_btn_submit").on('click', function (){
        let amount =$("#send-btc-payment_txt_amount").val();
        let pay_req =$("#send-btc-payment_txt_request").val();
        let non_custodial = $("#send-btc-payment_txt_request").data('custodial');
        let payment_type = "BTC";
        authorizePayment(amount, pay_req, payment_type, non_custodial);
    });
    $('#send-invoice-payment_txt_request').on('change', function() {
        let pay_req =$("#send-invoice-payment_txt_request").val();
        setAmountValue(pay_req);

    });
    $("#send-invoice-payment_btn_submit").on('click', function (){
        let pay_req =$("#send-invoice-payment_txt_request").val();
        let non_custodial = $("#send-invoice-payment_txt_request").data('custodial');
        let amount = $("#send-invoice-payment_txt_amount").val();
        let payment_type = "LND";
        authorizePayment(amount, pay_req, payment_type, non_custodial);
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
        var non_custodial = $("#create-payment_slct_lnd :selected").data('custodial');
        authorizePayment(payLoad['amount'], pay_req, lnd_name, payment_type, non_custodial);
    });

});