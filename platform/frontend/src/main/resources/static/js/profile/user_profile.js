function updateApiKeyTable() {
    $.get("update/api-key-list").done(function (fragment) {
        $("#api_key_table").replaceWith(fragment);
        const container = document.querySelector("#api-table-list");
        const ps = new PerfectScrollbar(container);
    })
}

function genApiKey() {
    var password = $('#modal-login-popup_txt_password').val();
    var block = $('#modal-login-popup_div_modal-reload');

    $(block).block({
        message: '<svg> ... </svg>',
        showOverlay: false,
        timeout: 2000, //unblock after 2 seconds
        css: {
            border: 0,
            color: '#000',
            padding: 0,
            backgroundColor: 'transparent'
        }
    });

    var post_url = "/generate-api-key";
    var request_method = "post";

    $("#modal-login-popup_btn_modal-dismiss").click();
    $.ajax({
        url: post_url,
        type: request_method,
        data: {
            'password': password
        },
        beforeSend: function (){
            blockArea("#user-profile_div_generate-api-area", "Generating API Key...");
        },
        success: function (data) {
            $("#api-key-gen_div_api-key-gen textarea").val(data);
            unblockArea("#user-profile_div_generate-api-area", "");
            Snackbar.show({
                text: "Successfully Created API Key",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            updateApiKeyTable();

        },
        error: function () {
            unblockArea("#user-profile_div_generate-api-area", "");
            Snackbar.show({
                text: "Failed to Get API Key",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

$(document).ready(function () {
    $("#exampleModal").on('shown.bs.modal', function () {
        $('#modal-login-popup_txt_password').get(0).focus();
    });
    $("#standardModal").on('shown.bs.modal', function () {
        $('#modal-delete-popup_txt_delete-api-password').get(0).focus();
    });
    $('#api-key-gen_btn_api-key-gen').on('click', function (event) {
        event.preventDefault();
        $('#modal-login-popup_txt_password').val("");
        $('#exampleModal').modal('show');
    })


    //pop up prompt for login before generating api key
    $('#modal-login-popup_btn_modal-blockui').on('click', function () {
        genApiKey();

    });

    $('#api-key-gen_btn_copy-to-clipboard').on('click', function () {
        var apiKey = $('#api-key-gen_div_api-key-gen textarea').val();
        try {
            navigator.clipboard.writeText(apiKey);
            Snackbar.show({
                text: "Successfully Copied API Key",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
        } catch (err) {
            Snackbar.show({
                text: "Failed to Copy API Key",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });


});

function copyApiKeys(apiKey) {
    try {
        navigator.clipboard.writeText(apiKey);
        Snackbar.show({
            text: "Successfully Copied API Key",
            pos: 'top-center',
            actionTextColor: '#fff',
            backgroundColor: '#8dbf42'
        });
    } catch (err) {
        Snackbar.show({
            text: "Failed to Copy API Key",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    }
}

//set api key to delete
function setApiKey(apiKey) {
    $('#modal-delete-popup_frm_modal-delete-form')[0].reset();
    $("#standardModal").modal("show");
    $('#modal-delete-popup_txt_api-key-modal:input').val(apiKey);
}

function deleteApiKey() {

    var token = $('#api-key-gen_txt_token').val();
    var apiKey = $('#modal-delete-popup_txt_api-key-modal').val();
    var password = $('#modal-delete-popup_txt_delete-api-password').val();

    $("#standardModal").modal('toggle');
    $.ajax({
        url: '/deactivate/api-key',
        type: 'post',
        data: {
            'password': password,
            'apiKey': apiKey,
            'token': token,
        },
        success: function () {

            Snackbar.show({
                text: "Successfully Deactivated Pubkey",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
            updateApiKeyTable();
        },

        error: function (response) {
            let error = JSON.parse(response['responseText']);
            Snackbar.show({
                text: error['message'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

$(".clickable-link").click(function () {
    window.open($(this).attr('href'), '_blank');
});