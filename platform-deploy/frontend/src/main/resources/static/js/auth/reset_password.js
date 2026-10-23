function checkPasswordMatch() {
    var password = $("#reset-password_txt_password").val();
    var confirmPassword = $("#reset-password_txt_confirm-password").val();

    if (password === confirmPassword) {
        $(".invalid-feedback").hide();
    }else {
        $(".invalid-feedback").show();
    }
}
let togglepassword = document.getElementById("reset-password_chk_toogle-password");
if (togglepassword) {
    togglepassword.addEventListener('click', function() {
        let password = document.getElementById("reset-password_txt_password");
        let confirm_password = document.getElementById("reset-password_txt_confirm-password");
        if (password.type === "password" && confirm_password.type === "password" ) {
            password.type = "text";
            confirm_password.type = "text";
        } else {
            password.type = "password";
            confirm_password.type = "password";
        }
    });
}
$(document).ready(function() {

    $(".invalid-feedback").hide();
    $("#reset-password_txt_password, #reset-password_txt_confirm-password").keyup(checkPasswordMatch);

});