function loadingButton(id, button_message) {
    $("id").removeClass('btn-primary btn-lg');
    $("id").addClass('btn-outline-primary btn-lg');
    $("id").html(button_message +
        '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"feather feather-loader spin\">\n' +
        '<line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"6\"></line>\n' +
        '<line x1=\"12\" y1=\"18\" x2=\"12\" y2=\"22\"></line>\n' +
        '<line x1=\"4.93\" y1=\"4.93\" x2=\"7.76\" y2=\"7.76\"></line>\n' +
        '<line x1=\"16.24\" y1=\"16.24\" x2=\"19.07\" y2=\"19.07\"></line>\n' +
        '<line x1=\"2\" y1=\"12\" x2=\"6\" y2=\"12\"></line>\n' +
        '<line x1=\"18\" y1=\"12\" x2=\"22\" y2=\"12\"></line>\n' +
        '<line x1=\"4.93\" y1=\"19.07\" x2=\"7.76\" y2=\"16.24\"></line>\n' +
        '<line x1=\"16.24\" y1=\"7.76\" x2=\"19.07\" y2=\"4.93\"></line>\n' +
        '</svg>');
}

function regularButton(id, button_message) {
    $("id").removeClass('btn-outline-primary btn-lg');
    $("id").addClass('btn-primary btn-lg');
    $("id").html(button_message);
}

var getUrlParameter = function getUrlParameter(sParam) {
    var sPageURL = window.location.search.substring(1),
        sURLVariables = sPageURL.split('&'),
        sParameterName,
        i;

    for (i = 0; i < sURLVariables.length; i++) {
        sParameterName = sURLVariables[i].split('=');

        if (sParameterName[0] === sParam) {
            return typeof sParameterName[1] === undefined ? true : decodeURIComponent(sParameterName[1]).replaceAll('+', ' ');
        }
    }
    return false;
};
var togglePassword = document.getElementById("beta-registration_chk_toggle-password");

if (togglePassword) {
    togglePassword.addEventListener('click', function () {
        var x = document.getElementById("beta-registration_txt_password");
        if (x.type === "password") {
            x.type = "text";
        } else {
            x.type = "password";
        }
    });
}

function displayEnterCode() {
    $("#qrcode-login-modal_div_qrCodeLogin").modal("show");
}

function getCodeValue() {
    const inputs = document.querySelectorAll('#qrcode-login-modal_div_OTPInput > *[id]');
    let compiledOtp = '';
    for (let i = 0; i < inputs.length; i++) {
        compiledOtp += inputs[i].value;
    }
    return compiledOtp;
}

//set the cursor on the first input in the qr code model
function setCursorFocusOnFirst() {
    const inputs = document.querySelectorAll('#qrcode-login-modal_div_OTPInput > *[id]');
    inputs[0].focus();
}

//clears all the inputs and set the cursor on the first input in the qr code model
function clearInputs() {
    const inputs = document.querySelectorAll('#qrcode-login-modal_div_OTPInput > *[id]');
    for (let i = 0; i < inputs.length; i++) {
        inputs[i].value = '';
    }
    setCursorFocusOnFirst();
}

function displayQr(qrcode, qr_text) {
    $("#qrcodeimg").attr("src", qrcode);
    $("#qrcode-modal_copy_code").attr("data-value", qr_text);
    $("#qrcode-modal_text_code").text(qr_text);

    $("#qrcode-modal_div_qrCodeModal").modal('show');
}

function submitcode2FA() {
    var email = $('#beta-registration_txt_email').val();
    var password = $('#beta-registration_txt_password').val();
    $.ajax({
        url: "/beta/check-code",
        type: "POST",
        data: {
            'email': email,
            'password': password,
            'code': getCodeValue()
        },
        beforeSend: function(){
            loadingButton("#qrcode-login-modal_btn_OTPSubmit", "Loading...");
        },
        success: function (response) {
            window.location = '/profile';
        },
        error: function (response) {
            clearInputs();
            displayEnterCode();
            regularButton("#qrcode-login-modal_btn_OTPSubmit", "Continue");
            var error = JSON.parse(response['responseJSON']['message']);
            Snackbar.show({
                text: error['error_description'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
        }
    });
}

/* This creates all the OTP input fields dynamically. Change the otp_length variable  to change the OTP Length */
const $otp_length = 6;

const element = document.getElementById('qrcode-login-modal_div_OTPInput');
for (let i = 0; i < $otp_length; i++) {
    let inputField = document.createElement('input'); // Creates a new input element
    inputField.className = "col-2 rounded pl-1 mt-4 mb-4 p-2";
    // Do individual OTP input styling here;
    inputField.style.cssText = "color: black; text-shadow: 0 0 0 gray; text-align: center;";
    // Input field text styling. This css hides the text caret
    inputField.id = 'beta-landing-page_txt_otp-field' + i; // Don't remove
    inputField.maxLength = 1; // Sets individual field length to 1 char
    element.appendChild(inputField); // Adds the input field to the parent div (qrcode-login-modal_div_OTPInput)
}
var $input_form = $(".p-2");
$input_form.on({
    paste(event) {
        const clip = event.originalEvent.clipboardData.getData('text').trim();
        if (!/\d{6}/.test(clip)) return event.preventDefault();
        const s = [...clip];
        $input_form.val(i => s[i]).eq(5).focus();
    }
});
/*  This is for switching back and forth the input box for user experience */
const inputs = document.querySelectorAll('#qrcode-login-modal_div_OTPInput > *[id]');
for (let i = 0; i < inputs.length; i++) {
    inputs[i].addEventListener('keydown', function (event) {
        if (event.key === "Backspace") {
            inputs[i].value = '';
            if (i !== 0) {
                inputs[i - 1].focus();
            }
        } else if (event.key === "ArrowLeft" && i !== 0) {
            inputs[i - 1].focus();
        } else if (event.key === "ArrowRight" && i !== inputs.length - 1) {
            inputs[i + 1].focus();
        } else if (event.key === "Enter") {
            event.preventDefault();
            submitcode2FA();
        }
    });
    inputs[i].addEventListener('input', function () {
        inputs[i].value = inputs[i].value.toUpperCase(); // Converts to Upper case. Remove .toUpperCase() if conversion isnt required.
        if (i === inputs.length - 1 && inputs[i].value !== '') {
            return true;
        } else if (inputs[i].value !== '') {
            inputs[i + 1].focus();
        }
    });
}

function register(captchaResponse) {
    var firstname = $("#beta-registration_txt_firstname").val();
    var lastname = $("#beta-registration_txt_lastname").val();
    var username = $('#beta-registration_txt_email').val();
    var email = $('#beta-registration_txt_email').val();
    var password = $('#beta-registration_txt_password').val();
    // var invite = $('#beta-signup_txt_invite-code').val();
    $.ajax({
        url: "/beta/signup",
        type: "POST",
        data: {
            'firstname': firstname,
            'lastname': lastname,
            'username': username,
            'email': email,
            'password': password,
            'captchaResponse': captchaResponse
        },
        beforeSend: function () {
            loadingButton("#beta-registration_btn_signup", "Loading...");
        },
        success: function (response) {
            var success = JSON.parse(response);
            displayQr(success['qr_url'], success['qr']);
        },
        error: function (response) {
            regularButton("#beta-registration_btn_signup", "SIGN UP");
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
}

function checkUsername(username, disable_btn) {

    if (username == "" || username == null){
        $("#beta-registration_txt_username-response").html("Username Cannot be Empty").removeClass('text-success').addClass('text-danger');
        $("#beta-registration_btn_register-beta").prop('disabled', true);
    }else {
        $.ajax({
            url: '/check-username',
            type: "POST",
            data: {
                'username': username
            },
            success: function (response) {
                console.log(response);
                var success_msg = JSON.parse(response);
                console.log(success_msg);
                $("#beta-registration_txt_username-response").html(success_msg['message']).removeClass('text-danger').addClass('text-success');
                if (disable_btn) {
                    $("#beta-registration_btn_register-beta").prop('disabled', false);
                }
            },
            error: function (response) {
                console.log(response);
                var error_msg = JSON.parse(response['responseText']);
                console.log(error_msg)
                $("#beta-registration_txt_username-response").html(error_msg['message']).removeClass('text-success').addClass('text-danger');
                $("#beta-registration_btn_register-beta").prop('disabled', true);
            }
        });
    }
}

function checkEmail(email, disable_btn){
    if (email == "" || email == null){
        $("#beta-registration_txt_email-response").html("Email Cannot be Empty").removeClass('text-success').addClass('text-danger');
        $("#beta-registration_btn_register-beta").prop('disabled', true);
    }else {
        $.ajax({
            url: '/check-email',
            type: "POST",
            data: {
                'email': email
            },
            success: function (response) {
                var success_msg = JSON.parse(response);
                $("#beta-registration_txt_email-response").html(success_msg['message']).removeClass('text-danger').addClass('text-success');
                if (disable_btn) {
                    $("#beta-registration_btn_register-beta").prop('disabled', false);
                }
            },
            error: function (response) {
                var error_msg = JSON.parse(response['responseText']);
                $("#beta-registration_txt_email-response").html(error_msg['message']).removeClass('text-success').addClass('text-danger');
                $("#beta-registration_btn_register-beta").prop('disabled', true);

            }
        });
    }
}
