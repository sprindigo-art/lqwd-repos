$(document).ready(function () {
     updatePage(1,1,5,'false');
    $("#request-liquidity-form_btn_submit").on('click', function (event) {
        event.preventDefault();
        let num_of_weeks = $('#request-liquidity-form_txt_weeks').val();
        let amount = $("#request-liquidity-form_txt_amount").val();
        let pubkey = $("#request-liquidity-form_txt_pubkey").val();
        let ipAddress = $("#request-liquidity-form_txt_ip").val();
        let payment_type = $(".custom-control-input:checked").val();
        let percentage = num_of_weeks / 2 * 0.5;
        let percentageFee = percentage / 100;
        let fee = percentageFee * amount;
        fee = fee|0;
        let feeString = fee.toString();
        document.getElementById("calculating-fee-form_span_fee_to_pay").innerHTML = (feeString+" SAT");
        document.getElementById("calculating-fee-form_span_pubkey").innerHTML = (pubkey);
        document.getElementById("calculating-fee-form_span_type").innerHTML = (payment_type);
        document.getElementById("calculating-fee-form_span_address").innerHTML = (ipAddress);
        document.getElementById("calculating-fee-form_span_weeks").innerHTML = (num_of_weeks);
        document.getElementById("calculating-fee-form_span_amount").innerHTML = (amount+" SAT");
        $("#calculating_fee_form").modal('show');
    });

    $("#calculating-fee-form_btn_pay").on('click', function (event) {
        event.preventDefault();
        payFee();
    });
    $("#request-liquidity-form_btn_copy-fee").on('click', function (event) {
        copyToClipboard($("#request-liquidity-form_txt_fee").val());
    });
    $("#request-liquidity_btn_copy").on('click', function (event) {
        copyToClipboard($("#request-liquidity_input_invoice").val());
    });
    $("#request-liquidity_btn_getQr").on('click', function (event) {
        event.preventDefault();
        getAddressQRCode($("#request-liquidity_input_invoice").val());
    });
});
function updatePage(page,startPageIndex,endPageIndex,updatePageSet) {
    $.ajax({
        url: "/liquidity-list-page",
        type: "GET",
        data: {
            'page': page,
            'startPageIndex': startPageIndex,
            'endPageIndex': endPageIndex,
            'updatePageSet': updatePageSet
        },

        success: function (fragment) {
            $("#request-liquidity_div_lists").replaceWith(fragment);
        },
        error: function () {
            Snackbar.show({
                text: "Failed to show liquidity invoices",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}
function openLiquidityInvoiceDetails(invoice, currentPage) {
    $.ajax({
        url: "/get-liquidity-invoice-details",
        type: "GET",
        data: {
            "liquidityInvoice": invoice,
            "currentPage": currentPage
        },
        success: function (fragment) {
            $('#liquidity_invoice_details').replaceWith(fragment);
            $('#liquidity_invoice_details').modal('show');
        },
        error: function (response) {
            Snackbar.show({
                text: "Failed to Show details",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });

}
function copyToClipboard(invoice) {
    try {
        navigator.clipboard.writeText(invoice);

        Snackbar.show({
            text: "Successfully Copied invoice",
            pos: 'top-center',
            actionTextColor: '#fff',
            backgroundColor: '#8dbf42'
        });
    } catch (err) {
        Snackbar.show({
            text: "Failed to Copy invoice",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }
}

function getAddressQRCode(invoice) {
    $("#qrModal_div_qrModal").modal("show");
    $.get("/get-address-qrcode?address=" + invoice).done(function (data) {
        $("#qrCode").attr("src", "data:image/png;base64," + data);
    });
}
function payFee() {
    let pubkey = $("#request-liquidity-form_txt_pubkey").val();
    let amount = $("#request-liquidity-form_txt_amount").val();
    let numberOfWeeks = $("#request-liquidity-form_txt_weeks").val();
    let ipAddress = $("#request-liquidity-form_txt_ip").val();
    let payment_type = $(".custom-control-input:checked").val();
    let fee = document.getElementById("calculating-fee-form_span_fee_to_pay").innerHTML;
    if (amount == Math.floor(amount)) {
        $.ajax({
            url: "/send-liquidity-request",
            type: "POST",
            data: {
                'pubkey': pubkey,
                'amount': amount,
                'numberOfWeeks': numberOfWeeks,
                'nodeAddress': ipAddress,
                'type': payment_type,
                'fee': fee
            },
            beforeSend: function () {
                $("#calculating_fee_form").modal('hide');
                blockArea('#request-liquidity_div_request-area', "Creating Liquidity Request...");
            },
            success: function (response) {
                var success = JSON.parse(response);
                unblockArea('#request-liquidity_div_request-area', "");
                Snackbar.show({
                    text: success['message'],
                    pos: 'top-center',
                    actionTextColor: '#fff',
                    backgroundColor: '#8dbf42'
                });
                $("#request-liquidity_input_invoice").prop('value', success['invoice']);
                $("#request-liquidity-form_txt_fee").prop('value', success['fee']);
                updatePage(1,1,5,'false');
            },
            error: function (response) {
                var error = JSON.parse(response['responseText']);
                Snackbar.show({
                    text: error['message'],
                    pos: 'top-center',
                    duration: false,
                    actionTextColor: '#fff',
                    backgroundColor: '#e7515a'
                });
                unblockArea('#request-liquidity_div_request-area', "");
            }
        });
    }
    else {
        $("#calculating_fee_form").modal('hide');
        Snackbar.show({
            text: "Please provide a valid amount in Satoshi!",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }

}