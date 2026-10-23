var mode="";

//load last ten invoices invoices
function getInvoices() {
    $.ajax({
        url: "/get-invoice-frag",
        method: "GET",
        beforeSend: function (){
            blockArea("#invoices", "Loading Invoices...");
        },
        success: function (fragment) {
            unblockArea("#invoices", "Loading Invoices...");
            $("#invoices").replaceWith(fragment);
        },
        error: function (){
            unblockArea("#invoices", "Loading Invoices...");
            showPopup("Failed to Load Invoices", true);
        }
    });
}
//load last ten invoices invoices
function getLastTenInvoices() {
    $.ajax({
        url: "/get-list-ten-invoices",
        method: "GET",
        beforeSend: function (){
            blockArea("#invoices", "Loading Invoices...");
        },
        success: function (fragment) {
            unblockArea("#invoices", "Loading Invoices...");
            $("#invoices").replaceWith(fragment);
        },
        error: function (){
            unblockArea("#invoices", "Loading Invoices...");
            showPopup("Failed to Load Invoices", true);
        }
    });
}

function copyToClipboard(pay_request) {
    try {
        navigator.clipboard.writeText(pay_request);
        showPopup("Successfully Copied to Clipboard", false);
    } catch (err) {
        showPopup("Failed to Copy to Clipboard", true);
    }
}

function getQRCode(pay_req, imgElement) {
    //when button is clicked get qr code and popup display
    $.get("/get-payreq-qrcode?payreq=" + pay_req).done(function (data) {
        unblockArea('#create-invoice_div_generate-invoice', "Creating Invoice...");
        $("#"+imgElement).attr("src", "data:image/png;base64," + data);
        
        $(".generate_"+mode+"_component").addClass("hidden_div");
        $(".show_"+mode+"_component").removeClass("hidden_div");
    });
}

function openLink(invoice, lnd_name) {
    window.open("/invoice-link?invoice=" + invoice + "&lnd_name=" + lnd_name, "_self");
}

function createBtcAddress(passphrase, password){
   $.ajax({
            url: "/create-address",
            type: "POST",
            data: {
                'passphrase': passphrase,
                'password': password
            },
            beforeSend: function () {
                blockArea('#create-invoice_div_generate-invoice', "Creating BTC Address...");
                $("#passphraseModal").modal("hide");
            },
            success: function (data) {
                var response = JSON.parse(data);
                $("#generate-btc_txt_request").val(response['address']);
                var pay_req = $("#generate-btc_txt_request").val();
                getQRCode(pay_req, "btcQrCode");
                showPopup("Successfully Created BTC Address", false);
                unblockArea('#create-invoice_div_generate-invoice', "Creating BTC Address...");
            },
            error: function () {
				//var pay_req = "34234234";
                //getQRCode(pay_req, "btcQrCode");
				unblockArea('#create-invoice_div_generate-invoice', "Creating BTC Address...");
                showPopup("Failed to Create BTC Address", true);
            }
        }); 
        
}

function createInvoice(amount, passphrase, password){
    if (amount == Math.floor(amount)) {
        $.ajax({
            url: "/create-invoice",
            type: "POST",
            data: {
                'amount': amount,
                'passphrase': passphrase,
                'password': password
            },
            beforeSend: function () {
                blockArea('#create-invoice_div_generate-invoice', "Creating Invoice...");
                $("#passphraseModal").modal("hide");
            },
            success: function (data) {
                var response = JSON.parse(data);
                $("#generate-invoice_txt_request").val(response['pay_req']);
                var pay_req = $("#generate-invoice_txt_request").val();
                getQRCode(pay_req, "payReqQrCode");
                showPopup("Successfully Created Invoice", false);
                unblockArea('#create-invoice_div_generate-invoice', "Creating Invoice...");
            },
            error: function () {
				//pay_req="2123";
                //getQRCode(pay_req, "payReqQrCode");
				unblockArea('#create-invoice_div_generate-invoice', "Creating Invoice...");
                showPopup("Failed to Create Invoice", true);
            }
        });
    } else {
        showPopup("Please provide a valid amount in Satoshi!", true);
    }
}

$(document).ready(function() {

    $("#passphraseModal").on('shown.bs.modal', function () {
        $('#modal-passphrase-popup_txt_password').get(0).focus();
    });
    $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
        if (e.which === 13) {
            e.preventDefault();
            if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                
                var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
                var password =  $("#modal-passphrase-popup_txt_password").val();
                
                if(mode == "invoice"){
					var amount = $("#modal-passphrase-popup_btn_modal-blockui").data('amount');
                	createInvoice(amount, passphrase, password);
				}else{
					createBtcAddress(passphrase, password);
				}
                
            } else {
                $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
            }
        }
    });
    $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
        if (e.which === 13) {
            e.preventDefault();
            var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
            var password =  $("#modal-passphrase-popup_txt_password").val();
            if(mode == "invoice"){
				var amount = $("#modal-passphrase-popup_btn_modal-blockui").data('amount');
                createInvoice(amount, passphrase, password);
			}else{
				createBtcAddress(passphrase, password);	
			}
        }
    });
    $("#modal-passphrase-popup_btn_modal-blockui").on('click', function (){
       
       var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
       var password =  $("#modal-passphrase-popup_txt_password").val();
       if(mode == "invoice"){
			var amount = $("#modal-passphrase-popup_btn_modal-blockui").data('amount');
            createInvoice(amount, passphrase, password);
		}else{
			createBtcAddress(passphrase, password);		
		}

    });
    
    
    $("#generate-invoice_btn_create").on('click', function (){
        var non_custodial = $("#select_node_custodial_state").val();

        var  amount = $("#generate-invoice_txt_amount").val();
		mode="invoice";
        console.log(non_custodial, amount);
        if(amount === ""){
            amount = 0;
        }

        if (non_custodial == "1"){
            $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        }else {
            $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        }
        $("#passphraseModal").modal("show");
        $("#modal-passphrase-popup_txt_passphrase").val("");
        $("#modal-passphrase-popup_txt_password").val("");
        $("#modal-passphrase-popup_btn_modal-blockui").attr('data-amount', amount);

    });
    
    
    $("#generate-btc_btn_create").on('click', function (){
        var non_custodial = $("#select_node_custodial_state").val();
		mode="btc";
        console.log(non_custodial);
        if (non_custodial == "1"){
            $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        }else {
            $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        }
        $("#passphraseModal").modal("show");
        $("#modal-passphrase-popup_txt_passphrase").val("");
        $("#modal-passphrase-popup_txt_password").val("");

    });
    
    
    

    $('#generate-invoice_btn_copy').on('click', function () {
		var pay_req = $("#generate-invoice_txt_request").val();
        copyToClipboard(pay_req);
    });
    
    $('#generate-btc_btn_copy').on('click', function () {
		var pay_req = $("#generate-btc_txt_request").val();
        copyToClipboard(pay_req);
    });

    
    $(".generate_invoice_component").removeClass("hidden_div");
    $(".generate_btc_component").removeClass("hidden_div");
});