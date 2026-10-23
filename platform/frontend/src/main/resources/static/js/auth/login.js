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
var togglePassword = document.getElementById("login_chk_toggle-password");

if (togglePassword) {
    togglePassword.addEventListener('click', function () {
        var x = document.getElementById("login_txt_password");
        if (x.type === "password") {
            x.type = "text";
        } else {
            x.type = "password";
        }
    });
}

/* This creates all the OTP input fields dynamically. Change the otp_length variable  to change the OTP Length */
const $otp_length = 6;

const element = document.getElementById('qrcode-login-modal_div_OTPInput');
for (let i = 0; i < $otp_length; i++) {
    let inputField = document.createElement('input'); // Creates a new input element
    inputField.className = "col-2 rounded pl-1 mt-4 mb-4 p-2";
    inputField.type = "text";
    // Do individual OTP input styling here;
    inputField.style.cssText = "color: black; text-shadow: 0 0 0 gray; text-align: center;";
    // Input field text styling. This css hides the text caret
    inputField.id = 'login_txt_otp-field' + i; // Don't remove
    inputField.maxLength = 1; // Sets individual field length to 1 char
    element.appendChild(inputField); // Adds the input field to the parent div (OTPInput)
}
// $("#OTPInput #login_txt_otp-field0").focus();
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
            submit2FA();
        }
    });
    inputs[i].addEventListener('input', function () {

        inputs[i].value = inputs[i].value.toUpperCase();
        // Converts to Upper case. Remove .toUpperCase() if conversion isnt required.

        if (i === inputs.length - 1 && inputs[i].value !== '') {
            return true;
        } else if (inputs[i].value !== '') {
            inputs[i + 1].focus();
        }
    });
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

function loadingButton(id) {
    $(id).removeClass('custom-login-btn');
    $(id).addClass('custom-login-btn-outline');
    $(id).prop('disabled', true);
    $(id).html('Loading...' +
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

function regularButton(id) {
    $(id).removeClass('custom-login-btn-outline');
    $(id).addClass('custom-login-btn');
    $(id).prop('disabled', false);
    $(id).html('Login');
}


//check credentials
function login(email, password) {
    $.ajax({
        url: "/login-check",
        type: "POST",
        data: {
            'email': email,
            'password': password,
        },
        beforeSend: function () {
            loadingButton("#login_btn_login");
        },
        success: function (response) {
            displayEnterCode();
            let success = JSON.parse(response);
        },
        error: function (response) {
            var error = JSON.parse(response['responseText']);
            regularButton("#login_btn_login");
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

//success credentials
function loginW2fa(email, password) {
    $.ajax({
        url: "/homepage",
        type: "POST",
        data: {
            'email': email,
            'password': password,
            'code': getCodeValue()
        },
        beforeSend: function () {
            loadingButton("#qrcode-login-modal_btn_OTPSubmit");
        },
        success: function (response) {
            $("#qrcode-login-modal_div_qrCodeLogin").modal('hide');
            regularButton("#qrcode-login-modal_btn_OTPSubmit");
            loadingButton("#login_btn_login");
            window.location = '/profile';
            return true;
        },
        error: function (response) {
            regularButton("#qrcode-login-modal_btn_OTPSubmit");
            clearInputs();
            displayEnterCode();
            var error = JSON.parse(response['responseText'])['error'];
            error = JSON.parse(error);

            Snackbar.show({
                text: error['error_description'],
                pos: 'top-center',
                duration: false,
                actionTextColor: '#fff',
                backgroundColor: '#e7515a'
            });
            return false;
        }
    });
}

function submit2FA() {
    let email = $('#login_txt_email').val();
    let password = $('#login_txt_password').val();

    loginW2fa(email, password);

}

function clearInputs() {
    const inputs = document.querySelectorAll('#qrcode-login-modal_div_OTPInput > *[id]');
    for (let i = 0; i < inputs.length; i++) {
        inputs[i].value = '';
    }
    setCursorFocusOnFirst();
}

function setCursorFocusOnFirst() {
    const inputs = document.querySelectorAll('#qrcode-login-modal_div_OTPInput > *[id]');
    inputs[0].focus();
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

function copyCode(value) {
    try {
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

$(document).ready(function () {
    $('#qrcode-login-modal_div_qrCodeLogin').on('shown.bs.modal', function () {
        $('#login_txt_otp-field0').focus();
    })

    $("#login_btn_login").on("click", function (event) {
        event.preventDefault();
        let email = $('#login_txt_email').val();
        let password = $('#login_txt_password').val();
        login(email, password);

    });

    $("#qrcode-login-modal_div_qrCodeLogin").on('hide.bs.modal', function () {
        regularButton("#login_btn_login");
    });

    $("#qrcode-modal_btn_doneQr").on('click', function () {
        $("#qrcode-modal_div_qrCodeModal").modal("hide");
        $("#qrcode-login-modal_div_qrCodeLogin").modal("show");
    });

    $('#qrcode-login-modal_btn_OTPSubmit').on('click', function (event) {
        event.preventDefault();
        submit2FA();
    });

    $("#qrcode-modal_copy_code").on('click', function (e) {
        var value = $(this).data("value");
        copyCode(value);
    });

    $("#toggle-password-open").on('click', function (){
            $("#toggle-password-open").addClass("d-none");
            $("#toggle-password-close").removeClass("d-none");

            $("#login_txt_password").attr('type', 'text');
    });

    $("#toggle-password-close").on('click', function (){

        $("#toggle-password-close").addClass("d-none");
        $("#toggle-password-open").removeClass("d-none");

        $("#login_txt_password").attr('type', 'password');

    });
});