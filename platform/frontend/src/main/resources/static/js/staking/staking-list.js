function copyToClipboard(address) {
    try {
        navigator.clipboard.writeText(address);

        Snackbar.show({
            text: "Successfully Copied Address",
            pos: 'top-center',
            actionTextColor: '#fff',
            backgroundColor: '#8dbf42'
        });
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

function openInvoiceDetails(rhash){
    window.open("/invoice?invoice=" + rhash, "_self");
}

function getStakingAddressQRCode(address) {
    $("#qrStakingModal_div_qrModal").modal("show");
    $.get("/get-address-qrcode?address=" + address).done(function (data) {
        $("#stakingQrCode").attr("src", "data:image/png;base64," + data);
    });
}


