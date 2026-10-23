function displayPaymentDetails(lnd_name, transaction) {
    $.get("/get-transaction-details?lnd_name=" + lnd_name + "transaction=" + transaction).done(function (fragment) {
        $("#transaction-detail-content").replaceWith(fragment);
    });
}

$(document).ready(function () {

    $("#payment-request-form_btn_lookup").on('click', function () {
        var pay_req = $("#payment-request-form_txt_pay-req").val();
        $.ajax({
            url: "/get-payment-details",
            type: "GET",
            data: {
                'pay_req': pay_req
            },
            success: function (data) {
                $("#payment-details").replaceWith(data);
                Snackbar.show({
                    text: "Look Up Pay Req Success",
                    pos: 'top-center',
                    actionTextColor: '#fff',
                    backgroundColor: '#8dbf42'
                });

            },
            error: function (data) {
                var error = JSON.parse(data['responseText']);
                Snackbar.show({
                    text: error['message'],
                    pos: 'top-center',
                    duration: false,
                    actionTextColor: '#fff',
                    backgroundColor: '#e7515a'
                });
            }
        });

    });

});
$(".clickable-link").click(function () {
    window.open($(this).attr('href'), '_blank');
});