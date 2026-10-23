function getQRCode(pay_req, imgElement) {
    //when button is clicked get qr code and popup display
    $.get("/get-payreq-qrcode?payreq=" + pay_req).done(function (data) {
        unblockArea('#create-invoice_div_generate-invoice', "Creating Invoice...");
        $("#"+imgElement).attr("src", "data:image/png;base64," + data);

        $(".generate_"+mode+"_component").addClass("hidden_div");
        $(".show_"+mode+"_component").removeClass("hidden_div");
    });
}

function getListOfAddresses() {

    $.ajax({
        url: "/get-addresses-list",
        type: "GET",
        beforeSend: function () {
            blockArea("#lnd-address_div_addresses-list", "Getting Address List...");
        },
        success: function (fragment) {
            unblockArea("#lnd-address_div_addresses-list", "Getting Address List...");
            $("#lnd-address_div_addresses-list").replaceWith(fragment);

            $('#lnd-address-table').DataTable({
                "lengthMenu": [5, 10, 20, 50],
                "pageLength": 5,
                "bFilter": false
            });
        },
        error: function (data) {
            console.log(data);
            var response = JSON.parse(data);
            unblockArea("#lnd-address_div_addresses-list", "Getting Address List...");
            showPopup(JSON.parse(response['responseText'])['message'], true);
        }
    });
}

function copyToClipboard(address) {
    try {
        if (address.length == 0){
            Snackbar.show({
                text: "Cannot Copy Empty Field",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }else {
            navigator.clipboard.writeText(address);

            Snackbar.show({
                text: "Successfully Copied Address",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
        }
    } catch (err) {
        Snackbar.show({
            text: "Failed to Copy Address",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }
}

function createBtcAddress(){
    var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
    var password =  $("#modal-passphrase-popup_txt_password").val();

    $.ajax({
        url: "/create-address",
        type: "POST",
        data: {
            'passphrase': passphrase,
            'password': password
        },
        beforeSend: function () {
            blockArea('#create-address-form', "Creating BTC Address...");
            $("#passphraseModal").modal("hide");
        },
        success: function (data) {
            var response = JSON.parse(data);
            $("#generate-btc_txt_request").val(response['address']);
            var pay_req = $("#generate-btc_txt_request").val();
            getQRCode(pay_req, "btcQrCode");
            $(".show_btc_component").removeClass("hidden_div");
            showPopup("Successfully Created BTC Address", false);
            unblockArea('#create-address-form', "Creating BTC Address...");
        },
        error: function () {
            //var pay_req = "34234234";
            //getQRCode(pay_req, "btcQrCode");
            unblockArea('#create-address-form', "Creating BTC Address...");
            showPopup("Failed to Create BTC Address", true);
        }
    });

}

function authenticateAddressCreation() {

    var non_custodial = $("#select_node_custodial_state").val();

    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");
    $("#passphraseModal").modal('show');

    $('#modal-passphrase-popup_txt_password').get(0).focus();

    //passphrase needed
    $("#modal-passphrase-popup_btn_modal-blockui").attr('onclick', 'createBtcAddress();');

    if (non_custodial=="1"){
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        $("#passphraseModal").modal('show');

    }else{
        //no passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        $("#passphraseModal").modal('show');
    }

    $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
        if (e.which === 13) {
            e.preventDefault();
            if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                createBtcAddress();
            } else {
                $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
            }
        }
    });
    $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
        if (e.which === 13) {
            e.preventDefault();
            createBtcAddress();
        }
    });

}

$(document).ready(function(){

    getListOfAddresses();

    $("#generate-btc_btn_create").on('click', function (){
       authenticateAddressCreation();
    });

});
