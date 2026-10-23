/*

THESE NEXT LINES ARE CUSTOMIZABLE SETTINGS

*/

var invoicemac = process.env.INVOICEMAC;
var adminmac = process.env.ADMINMAC;
var lndendpoint = process.env.LNDENDPOINT; //e.g. https://127.0.0.1:8080 or https://cloud-59.voltage.com
var min_amount = process.env.MINAMOUNT;
var max_amount = process.env.MAXAMOUNT;
var fee_type = process.env.FEETYPE; //alternative: "absolute"
var fee = process.env.FEE; //if fee type is absolute, this integer is a flat rate, e.g. you will get 5 sats per swap; otherwise you get a rate corresponding to e.g. 5% of each swap


