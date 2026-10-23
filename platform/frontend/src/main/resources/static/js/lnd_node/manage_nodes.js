function openPasswordModalRestartUnlock(lnd_name,action, non_custodial){
    if (non_custodial==="true"){
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
    }else{
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
    }
    if (action === "unlock"){
        $("#modal-passphrase-popup_btn_modal-blockui").attr("onclick", 'unlockLndNode("'+lnd_name+'");');
        $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                    unlockLndNode(lnd_name);
                } else {
                    $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
                }
            }
        });
        $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                unlockLndNode(lnd_name);
            }
        });
    }else{
        $("#modal-passphrase-popup_btn_modal-blockui").attr("onclick", 'restartLndNode("'+lnd_name+'");');
        $('#modal-passphrase-popup_txt_password').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                if($("#passphrase-div-noncustodial-modal").prop('hidden')){
                    restartLndNode(lnd_name);
                } else {
                    $('#modal-passphrase-popup_txt_passphrase').get(0).focus();
                }
            }
        });
        $('#modal-passphrase-popup_txt_passphrase').on('keypress', function (e) {
            if (e.which === 13) {
                e.preventDefault();
                restartLndNode(lnd_name);
            }
        });
    }
    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");
    $("#passphraseModal").modal('show');
}

function restartLndNode(nodeName){
    var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
    var password = $("#modal-passphrase-popup_txt_password").val();

    $.ajax({
        url: '/lnd-restart',
        type: "POST",
        data: {
            'password': password,
            'nodeName': nodeName,
            'passphrase': passphrase
        },
        beforeSend: function (){
            $("#passphraseModal").modal("hide");
             blockArea(".layout-px-spacing", "Restarting the Node...");
        },
        success: function (response) {
            unblockArea(".layout-px-spacing", "Restarting the Node...");
            let success = JSON.parse(response);
            Snackbar.show({
                text: success['message'],
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            refreshLndNodeList();
            getLndNodeInfo(nodeName);
        },
        error: function (response) {
            unblockArea(".layout-px-spacing", "Restarting the Node...");
            let error = JSON.parse(response['responseText']);
            Snackbar.show({
                text: error['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            refreshLndNodeList();
        }
    });
}
function unlockLndNode(nodeName){
    var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
    var password = $("#modal-passphrase-popup_txt_password").val();

    $.ajax({
        url: '/lnd-unlock',
        type: "POST",
        data: {
            'password': password,
            'nodeName': nodeName,
            'passphrase': passphrase
        },
        beforeSend: function (){
            $("#passphraseModal").modal("hide");
            blockArea(".layout-px-spacing", "Unlocking LND Node...");
        },
        success: function (response) {
            unblockArea(".layout-px-spacing", "Unlocking LND Node...");
            let success = JSON.parse(response);
            Snackbar.show({
                text: success['message'],
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            refreshLndNodeList();
            getLndNodeInfo(nodeName);
        },
        error: function (response) {
            unblockArea(".layout-px-spacing", "Unlocking LND Node...");
            let error = JSON.parse(response['responseText']);
            Snackbar.show({
                text: error['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            refreshLndNodeList();
        }
    });
}

function refreshLndNodeList() {
    $.ajax({
        url: "/get-lnd-node-list",
        type: "GET",
        beforeSend: function (){
            blockArea("#manage-lnd-node_div_lnd-node-card", "Loading...");
        },
        success: function (fragment){
            unblockArea("#manage-lnd-node_div_lnd-node-card", "Loading...");
            $("#manage-lnd-node_div_lnd-node-card").replaceWith(fragment);
        },
        error: function (data){
            unblockArea("#manage-lnd-node_div_lnd-node-card", "Loading...");
            Snackbar.show({
                text: "Failed to Load LND Nodes",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function getLndNodeInfo(lnd_name) {
    $.ajax({
        url: "/get-manage-node-details?lnd_name=" + lnd_name,
        type: "GET",
        beforeSend: function (){
            blockArea("#manage-node-details", "Loading LND Details...");
        },
        success: function (fragment){
            unblockArea("#manage-node-details", "Loading...");
            $("#manage-node-details").replaceWith(fragment);
        },
        error: function (data){
            unblockArea("#manage-node-details", "Loading...");
            Snackbar.show({
                text: "Failed to Load LND Details",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}


function copyToClipboard(value) {
    try {
        navigator.clipboard.writeText(value);

        Snackbar.show({
            text: "Successfully Copied Pubkey to Clipboard",
            pos: 'top-center',
            actionTextColor: '#fff',
            backgroundColor: '#8dbf42'
        });
    } catch (err) {
        Snackbar.show({
            text: "Failed to Copy Pubkey to Clipboard",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }
}
$(document).ready(function () {
    let url_lnd_name = GetURLParameter('lnd_name');
    if(url_lnd_name!= null){
        getLndNodeInfo(url_lnd_name);
    }
    $(".pb-3").on('click', function () {
        var lnd_name = $(this).attr("data-value");
        var custodial = $(this).data("custodial");
        getLndNodeInfo(lnd_name);
    });
    $("#passphraseModal").on('shown.bs.modal', function () {
        $('#modal-passphrase-popup_txt_password').get(0).focus();
    });
    $(".clickable-link").click(function () {
        window.open($(this).attr('href'), '_blank');
    });
});