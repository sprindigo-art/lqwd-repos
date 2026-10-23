function updateInvoiceSelectList(lnd_name, invoice_hash) {
    $.get("/get-invoices?lnd_name=" + lnd_name).done(function (jsonArray) {
        if (invoice_hash != null){
            $.each(JSON.parse(jsonArray), function (index, value) {
                if (value['invoice'] === invoice_hash) {
                    console.log(invoice_hash);
                    $('#invoice-details_slct_invoice-select').append($('<option/>', {
                        value: value['invoice'],
                        text: value['invoice'],
                        selected: true
                    }));
                }else{
                    $('#invoice-details_slct_invoice-select').append($('<option/>', {
                        value: value['invoice'],
                        text: value['invoice']
                    }));
                }
            });
        }else{
            $("#invoice-detail_div_content").replaceWith("<div id='invoice-detail_div_content'></div>");
            document.getElementById("invoice-details_slct_invoice-select").options.length = 0;

            $('#invoice-details_slct_invoice-select').append($('<option/>', {
                value: "",
                text: "Select Invoice"
            }));

            $.each(JSON.parse(jsonArray), function (index, value) {
                $('#invoice-details_slct_invoice-select').append($('<option/>', {
                    value: value['invoice'],
                    text: value['invoice']
                }));
            });
        }

    })
}

function getInvoiceDetails(lnd_name, invoice) {
    $.ajax({
        url: "/get-invoice-details",
        method: "GET",
        data: {
            "lnd_name":lnd_name,
            "invoice": encodeURI(invoice)
        },
        success: function (fragment) {
            $("#invoice-detail_div_content").replaceWith(fragment);
        },
        error: function (data){
            console.log(data);
        }
    });
}

$(document).ready(function () {

    var url_lnd_name = GetURLParameter('lnd_name');
    var url_invoice = GetURLParameter('invoice');

    if (url_lnd_name != null) {
        updateInvoiceSelectList(url_lnd_name, url_invoice);
    }

    $('#invoice-details_slct_lnd-select').on('change', function () {
        var lnd_name = $("#invoice-details_slct_lnd-select :selected").attr('value');
        updateInvoiceSelectList(lnd_name, null);
    });

    $('#invoice-details_slct_invoice-select').on('change', function () {
        var invoice_hash = $("#invoice-details_slct_invoice-select :selected").attr('value');
        var lnd_name = $("#invoice-details_slct_lnd-select :selected").attr('value');
        getInvoiceDetails(lnd_name, invoice_hash);
    });
});

function copyPayReq(e) {
    try {
        var value = $(e).attr('value');
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