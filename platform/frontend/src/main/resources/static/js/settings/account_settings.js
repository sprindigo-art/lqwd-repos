function checkPasswordMatch() {
    var password = $("#reset-password_txt_new_password").val();
    var confirmPassword = $("#reset-password_txt_new-password-confirm").val();

    if (password !== confirmPassword) {
        $("#passMessage").html("*New Passwords Must Match!").css('color', 'red');
    } else {
        $("#passMessage").html("Passwords Match.").css('color', 'green');
    }
}

$(document).ready(function () {

    $("#reset-password_txt_new_password, #reset-password_txt_new-password-confirm").keyup(checkPasswordMatch);

    //ajax post request for reset password
    $("#reset-password_btn_reset-password").on('click', function () {
        $.ajax({
            url: "/resetpassword",
            type: "POST",
            data: {
                'curr_pass': $('#reset-password_txt_current_password').val(),
                'new_pass': $('#reset-password_txt_new_password').val(),
                'new_pass_confirm': $('#reset-password_txt_new-password-confirm').val(),
            },
            beforeSend: function () {
                blockArea('#toggleAccordion', "Reseting password...");
            },
            success: function (response) {
                unblockArea('#toggleAccordion', "");
                var success = JSON.parse(response);
                Snackbar.show({
                    text: success['message'],
                    pos: 'top-center',
                    actionTextColor: '#fff',
                    backgroundColor: '#8dbf42'
                });
            },
            error: function (response) {
                unblockArea('#toggleAccordion', "");
                var error = JSON.parse(response['responseText']);
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

    $("#account-setting_btn_multiple-reset").on("click", function (event) {
        event.preventDefault();
        $('#general-info')[0].reset();
        $('#contact')[0].reset();
    });

    $('#toggles_chk_receive-news').on('click', function () {
        if ($('#toggles_chk_receive-news').is(":checked")) {
            updateReceiveNews(true);
        } else {
            updateReceiveNews(false);
        }
    });

    $('#qrcode-setting-modal_btn_doneQr').on('click', function () {
        window.location = '/signout';
    });

    $("#qrcode-setting-modal_btn_close-modal-qr").on('click', function () {
        Snackbar.show({
            text: "Please Scan QR Code and Click Continue to Save 2FA Setting",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    });

    $('#qrCodeModal').on('hidden.bs.modal', function (event) {
        Snackbar.show({
            text: "Please Scan QR Code and Click Continue to Save 2FA Setting",
            pos: 'top-center',
            duration: false,
            actionTextColor: '#fff',
            backgroundColor: '#e7515a'
        });
    });

    $('#exampleModal').on('hidden.bs.modal', function (event) {
        if ($(this).attr('data-email') === "false") {
            if (!$("#qrCodeModal").is(':visible')) {
                if ($('#toggles_chk_fa2').is(":checked")) {
                    $('#toggles_chk_fa2').prop("checked", false);
                } else {
                    $('#toggles_chk_fa2').prop("checked", true);
                }
            }
        }
    });

    $('#modal-login-popup_btn_modal-blockui').on('click', function () {
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
    });

});

function updateReceiveNews(url_check) {

    var url = null;

    if (url_check) {
        url = "/update/receive-news/on";
    } else {
        url = "update/receive-news/off";
    }

    $.ajax({
        url: url,
        type: "POST",
        success: function (response) {
            Snackbar.show({
                text: "Successfully Updated Allow Newsletters",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });
        },
        error: function (response) {
            Snackbar.show({
                text: "Failed to Update Allow Newsletters",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

function setDataCheck(value) {
    $("#modal-login-popup_btn_modal-blockui").attr('data-email', value);
}

function checkEmailChange() {
    //contact info
    var original_email = $("#contact_txt_email").data().initial;
    var email = $("#contact_txt_email").val();

    if (original_email !== email) {
        $("#exampleModal").modal("show");

        $("#modal-login-popup_btn_modal-blockui").on('click', function (event) {
            setDataCheck("true");
            $("#exampleModal").modal('hide');
            //authenticate user
            var password = $("#modal-login-popup_btn_password").val();
            $.ajax({
                url: "/account-settings/authenticate",
                type: "POST",
                data: {
                    'email': original_email,
                    'password': password
                },
                success: function (response) {
                    updateAjaxCall(true);
                },
                error: function (response) {
                    Snackbar.show({
                        text: "Failed to Authenticate User",
                        pos: 'top-center',
                        duration: false,
                        actionTextColor: '#fff',
                        backgroundColor: '#e7515a'
                    });
                }
            });
        });
    } else {
        updateAjaxCall();
    }
}

function updateAjaxCall(redirect = false) {
    //general info
    var firstname = $("#general-info_txt_firstName").val();
    var lastname = $("#general-info_txt_lastName").val();
    var username = $("#general-info_txt_username").val();

    var email = $("#contact_txt_email").val();
    var receiveNews = $("#toggles_chk_receive-news").is(":checked").toString();
    var phone = $("#contact_txt_phone").val();

    $.ajax({
        url: "/account-settings/update",
        type: "POST",
        data: {
            'firstName': firstname,
            'lastName': lastname,
            'username': username,
            'email': email,
            'phone': phone,
            'receiveNews': receiveNews,
            'token': $('#reset-password_txt_token').val()
        },
        before: function () {
            setDataCheck("true");
        },
        success: function (response) {
            $("#general-contact-info").html(response);
            Snackbar.show({
                text: "Successfully Updated Information",
                pos: 'top-center',
                actionTextColor: '#fff',
                backgroundColor: '#8dbf42'
            });

            if (JSON.parse(response).hasOwnProperty('redirect')) {
                window.location = '/login';
            }
        },
        error: function (response) {
            Snackbar.show({
                text: "Failed to Update Information",
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            redirect = false;
        }
    });
}