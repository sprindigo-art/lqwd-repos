function getQRCode(pay_req, imgElement) {
    //when button is clicked get qr code and popup display
    $.get("/get-payreq-qrcode?payreq=" + pay_req).done(function (data) {
        $("#"+imgElement).attr("src", "data:image/png;base64," + data);
    });
}

function showDetailsModal(type){

    if (type === 'transaction'){
        $("#transactionDetailsModal").modal('show');
    }

    if (type === 'invoice'){
        $("#invoiceDetailsModal").modal('show');
    }

    if (type === 'payment'){
        $("#paymentDetailsModal").modal('show');
    }
}

function hideDetailsModal(type){
    if (type === 'transaction'){
        $("#transactionDetailsModal").modal('hide');
    }

    if (type === 'invoice'){
        $("#invoiceDetailsModal").modal('hide');
    }

    if (type === 'payment'){
        $("#paymentDetailsModal").modal('hide');
    }
}

function getInvoiceDetails(invoice){
    $.ajax({
        url: "/invoice-details",
        type: "POST",
        data: {
            "invoice": invoice
        },
        success: function (fragment) {
            $("#invoiceDetailsModal").replaceWith(fragment);
            showDetailsModal('invoice');
        },
        error: function (data) {
            hideDetailsModal('invoice');
        }
    });
}

function getPaymentDetails(payment){
    $.ajax({
        url: "/payment-details",
        type: "POST",
        data: {
            "payment": payment
        },
        success: function (fragment) {
            $("#paymentDetailsModal").replaceWith(fragment);
            showDetailsModal('payment');
        },
        error: function (data) {
            hideDetailsModal('payment');
        }
    });
}

function getTransactionDetails(transaction){
    $.ajax({
        url: "/transaction-details",
        type: "POST",
        data: {
            "transaction": transaction
        },
        success: function (fragment) {
            $("#transactionDetailsModal").replaceWith(fragment);
            showDetailsModal('transaction');
        },
        error: function (data) {
            console.log(data);
            hideDetailsModal('transaction');
        }
    });
}

function syncPayments(){
    $.ajax({
        url: "/sync-payments-data",
        type: "GET",
        success: function (data) {
            var response = JSON.parse(data);
            showPopup(response['message'], false);
        },
        error: function (data) {
            var response = JSON.parse(data);
            showPopup(response['message'], true);
        }
    });
}

$(document).ready(function(){

    $(document).ready(function () {
        $('#list-transaction_tbl_list').DataTable({
            "lengthMenu": [5, 10, 20, 50],
            "pageLength": 5,
            "responsive": true
        });

        $('#list-invoice_tbl_list').DataTable({
            "lengthMenu": [5, 10, 20, 50],
            "pageLength": 5,
            "responsive": true
        });

        $('#list-payment_tbl_list').DataTable({
            "lengthMenu": [5, 10, 20, 50],
            "pageLength": 5,
            "responsive": true
        });
    });
});