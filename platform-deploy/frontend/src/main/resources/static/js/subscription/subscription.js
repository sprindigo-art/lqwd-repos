var getInputStatus = document.getElementById('subscription_chk_radio');
var getPricingContainer = document.getElementsByClassName('pricing-plans-container')[0];
var getYearlySwitch = document.getElementsByClassName('billed-yearly-radio')[0];
getInputStatus.addEventListener('change', function() {
    var isChecked = getInputStatus.checked;
    if (isChecked) {
        getPricingContainer.classList.add("billed-yearly");
        getYearlySwitch.classList.add("billed-yearly-switch");
    } else {
        getYearlySwitch.classList.remove("billed-yearly-switch");
        getPricingContainer.classList.remove("billed-yearly");
    }
})