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
var togglePassword = document.getElementById("registration_chk_toggle-password");

if (togglePassword) {
    togglePassword.addEventListener('click', function () {
        var x = document.getElementById("registration_txt_password");
        if (x.type === "password") {
            x.type = "text";
        } else {
            x.type = "password";
        }
    });
}

//display the qr code model
function displayEnterCode() {
    $("#qrcode-login-modal_div_qrCodeLogin").modal("show");
}

function displayQr(qrcode) {
    $("#qrcodeimg").attr("src", qrcode);
    $("#qrcode-modal_div_qrCodeModal").modal('show');
}

//submits 2FA
function submit2FAcode() {
    var email = $('#registration_txt_username').val();
    var password = $('#registration_txt_password').val();
    $.ajax({
        url: "/check-code",
        type: "POST",
        data: {
            'email': email,
            'password': password,
            'code': getCodeValue()
        },
        success: function (response) {
            window.location = '/profile';
        },
        //if error clear the inputs and set cursor on the first input.
        error: function (response) {
            clearInputs();
            displayEnterCode();
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

function getCodeValue() {
    const inputs = document.querySelectorAll('#qrcode-login-modal_div_OTPInput > *[id]');
    let compiledOtp = '';
    for (let i = 0; i < inputs.length; i++) {
        compiledOtp += inputs[i].value;
    }

    return compiledOtp;
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
    inputField.id = 'qrcode-login-modal_txt_otp-field' + i; // Don't remove
    inputField.maxLength = 1; // Sets individual field length to 1 char
    element.appendChild(inputField); // Adds the input field to the parent div (OTPInput)
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
            submit2FAcode();
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

function loadingButton() {
    $("#registration_btn_register").removeClass('btn-primary btn-lg');
    $("#registration_btn_register").addClass('btn-outline-primary btn-lg');
    $("#registration_btn_register").html('Loading...' +
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

function regularButton() {
    $("#registration_btn_register").removeClass('btn-outline-primary btn-lg');
    $("#registration_btn_register").addClass('btn-primary btn-lg');
    $("#registration_btn_register").html('Get Started!');
}

function register(username, email, password, captchaResponse) {
    $.ajax({
        url: $(this).attr("action"),
        type: "POST",
        data: {
            'username': username,
            'email': email,
            'password': password,
            'captchaResponse': captchaResponse
            // 'fa2'       : fa2
        },
        beforeSend: function () {
            loadingButton();
        },
        success: function (response) {
            var success = JSON.parse(response);
            displayQr(success['qr_url']);
        },
        error: function (response) {
            regularButton();
            console.log(response)
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

$(document).ready(function () {
    //check username and email on keyup
    $("#registration_txt_username").on('change', function () {
        $.ajax({
            url: '/check-username',
            type: "POST",
            data: {
                'username': $('#registration_txt_username').val()
            },
            success: function (response) {
                $("#registration_span_username-response").html(response).removeClass('text-danger').addClass('text-success');
            },
            error: function (response) {
                $("#registration_span_username-response").html(response['responseText']).removeClass('text-success').addClass('text-danger');
            }
        });
    });

    $("#registration_txt_email").on('change', function () {
        $.ajax({
            url: '/check-email',
            type: "POST",
            data: {
                'email': $('#registration_txt_email').val()
            },
            success: function (response) {
                $("#registration_span_email-response").html(response).removeClass('text-danger').addClass('text-success');
            },
            error: function (response) {
                $("#registration_span_email-response").html(response['responseText']).removeClass('text-success').addClass('text-danger');
            }
        });
    });

    //on registration submit check if user is wanting to use 2fa
    $("#registration_frm_registration").submit(function (event) {
        event.preventDefault();
        var username = $('#registration_txt_username').val();
        var email = $('#registration_txt_email').val();
        var password = $('#registration_txt_password').val();
        // var fa2 = ($("#fa2").is(":checked").toString() === "true");
        var secretKey = '[[${@captchaSettings.getSite()}]]';
        grecaptcha.ready(function () {
            grecaptcha.execute(secretKey,
                {action: '[[${T(lqwd.frontend.captcha.CaptchaServiceV3).REGISTER_ACTION}]]'})
                .then(function (response) {
                    register(username, email, password, response)
                });
        });
        $("#qrcode-modal_btn_doneQr").on('click', function () {
            $("#qrcode-modal_div_qrCodeModal").modal('hide');
            clearInputs();
            displayEnterCode();
            setCursorFocusOnFirst();
        });

        $('#qrcode-login-modal_btn_OTPSubmit').on('click', function (event) {
            event.preventDefault();
            submit2FAcode();
        });
    });
});