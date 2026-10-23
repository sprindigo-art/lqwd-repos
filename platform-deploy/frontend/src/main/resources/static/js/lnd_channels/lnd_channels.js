function openCloseChannelPopupModal(channel){
    $.ajax({
        url: "/close-channel-popup",
        type: "POST",
        data: {
            'channel': channel
        },
        success: function (data) {
            $("#close-channel-popup_div_modal").replaceWith(data);
            $("#close-channel-popup_div_modal").modal("show");
        },
        error: function (data) {
            var response = JSON.parse(data);
            showPopup(response['message'], true);
        }
    });
}

function closeInactiveChannel(channel_point, lnd_name){
    $("#close-channel-popup_div_modal").modal('hide');
    $.ajax({
        url: "/close-inactive-channel",
        type: "POST",
        data: {
            'channel_point': channel_point,
            'lnd_name': lnd_name,
            'password': $("#modal-passphrase-popup_txt_password").val(),
            'passphrase': $("#modal-passphrase-popup_txt_passphrase").val()
        },
        beforeSend: function () {
            $("#passphrase-div-noncustodial-modal").modal("hide");
            blockArea("#border-tabsContent", "Closing Channel...");
        },
        success: function (data) {
            showPopup("Successfully Closed Channel", false);
            unblockArea("#border-tabsContent", "");
        },
        error: function (data) {
            let error = JSON.parse(data['responseText']);
            unblockArea("#border-tabsContent", "");
            showPopup(error['message'], true);
        }
    });
}

function closeChannel(channel_point, lnd_name) {
    $("#close-channel-popup_div_modal").modal('hide');
    $.ajax({
        url: "/close-channel",
        type: "POST",
        data: {
            'channel_point': channel_point,
            'lnd_name': lnd_name,
            'password': $("#modal-passphrase-popup_txt_password").val(),
            'passphrase': $("#modal-passphrase-popup_txt_passphrase").val()
        },
        beforeSend: function () {
            $("#passphraseModal").modal('hide');
            blockArea("#border-tabsContent", "Closing Channel...");
        },
        success: function (data) {
            Snackbar.show({
                text: "Succesfully Closed Channel",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42',
                onActionClick: function(element) {
                    location.reload();
                },
                onClose: function (element){
                    location.reload();
                }
            });
            unblockArea("#border-tabsContent", "");
        },
        error: function (data) {
            let error = JSON.parse(data['responseText']);
            showPopup(error['message'], true);
            unblockArea("#border-tabsContent", "");
        }
    });
}

function showDetailsModal(){
    $("#lndChannelDetailsModal").modal('show');
}

function hideDetailsModal(){
    $("#lndChannelDetailsModal").modal('hide');
}

function showUpdateModal(){
    $("#lndUpdateChannelModal").modal('show');
}

function hideUpdateModal(){
    $("#lndUpdateChannelModal").modal('hide');
}

function authorizeAction(){
    hideUpdateModal();
    var non_custodial = $("#select_node_custodial_state").val();
    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");

    $("#modal-passphrase-popup_btn_modal-blockui").attr("onclick", 'updateChannelPolicy();');

    if (non_custodial=="1"){
        //passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        $("#passphraseModal").modal('show');

    }else{
        //no passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        $("#passphraseModal").modal('show');
    }
}

function getChannelDetails(channel, lnd_name){
    $.ajax({
        url: "/channel-details",
        type: "POST",
        data: {
            "channel": channel
        },
        success: function (fragment) {
            $("#lndChannelDetailsModal").replaceWith(fragment);
            showDetailsModal();
            return response['non-custodial'];
        },
        error: function (data) {
            console.log(data);
            hideDetailsModal();
        }
    });
}

function updateChannelView(channel, lnd_name){
    $.ajax({
        url: "/update-channel-view",
        type: "POST",
        data: {
            "channel": channel
        },
        success: function (fragment) {
            $("#lndUpdateChannelModal").replaceWith(fragment);

            showUpdateModal();
        },
        error: function (data) {
            console.log(data);
            hideUpdateModal();
        }
    });
}

function updateChannelPolicy(){

    var channel_point = $("#update-channel_txt_channel_point").val();
    var base_fee_msat = $("#update-channel_txt_base_fee_msat").val();
    var fee_rate_ppm = $("#update-channel_txt_fee_rate_ppm").val();
    var min_htlc_msat = $("#update-channel_txt_min_htlc_msat").val();
    var max_htlc_msat = $("#update-channel_txt_max_htlc_msat").val();
    var time_lock_delta = $("#update-channel_txt_time_lock_delta").val();
    var passphrase = $("#modal-passphrase-popup_txt_passphrase").val();
    var password = $("#modal-passphrase-popup_txt_password").val();

    $.ajax({
        url: "/update-channel-policy",
        type: "POST",
        data: {
            "channel_point": channel_point,
            "base_fee_msat": base_fee_msat,
            "fee_rate_ppm": fee_rate_ppm,
            "min_htlc_msat": min_htlc_msat,
            "max_htlc_msat": max_htlc_msat,
            "time_lock_delta": time_lock_delta,
            "password": password,
            "passphrase": passphrase
        },
        beforeSend: function(){
            $("#passphraseModal").modal('hide');
        },
        success: function (response) {
            Snackbar.show({
                text: "Successfully Updated Channel Policy",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
        },
        error: function (response) {
            var response = JSON.parse(response['responseText']);
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

function syncChannels(){
    $.ajax({
        url: "/sync-channels",
        type: "GET",
        beforeSend: function(){
          blockArea("#container", "Syncing Channels...");
        },
        success: function (data) {
            var response = JSON.parse(data);
            unblockArea("#container");
            Snackbar.show({
                text: response['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42',
                onActionClick: function(element) {
                    location.reload();
                },
                onClose: function (element){
                    location.reload();
                }
            });
        },
        error: function (data) {
            var response = JSON.parse(data);
            unblockArea("#container");
            showPopup(response['message'], true);
        }
    });
}

function authorizeCloseChannel(channel_point, lnd_name, active){
    var non_custodial = $("#select_node_custodial_state").val();
    $("#modal-passphrase-popup_txt_passphrase").val("");
    $("#modal-passphrase-popup_txt_password").val("");

    if (active) {
        $("#modal-passphrase-popup_btn_modal-blockui").attr("onclick", 'closeChannel("' + channel_point + '", "' + lnd_name + '");');
    }else{
        $("#modal-passphrase-popup_btn_modal-blockui").attr("onclick", 'closeInactiveChannel("' + channel_point + '", "' + lnd_name + '");');
    }

    if (non_custodial=="1"){
        //passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', false);
        $("#close-channel-popup_div_modal").modal('hide');
        $("#passphraseModal").modal('show');

    }else{
        //no passphrase needed
        $("#passphrase-div-noncustodial-modal").prop('hidden', true);
        $("#close-channel-popup_div_modal").modal('hide');
        $("#passphraseModal").modal('show');
    }
}