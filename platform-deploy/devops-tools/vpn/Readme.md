# VPN Setup
In order to setup vpn for new teammates, follow the instruction below

## Steps to create a config file
lets say we want to create ovpn file for "newdeveloper" in "dev" group with email address of "newdeveloper@lqwd.money". these items need to be changed for each new key and therefore are inside curly braces in the following steps as a reminder to do so.

* login to vpn virtual machine
* cd /etc/openvpn/easy-rsa/
* source ./vars
* export CLIENT_NAME={{newdeveloper}}
* ./build-key $CLIENT_NAME
  * country name [CA] : enter
  * State or province [BC]: enter
  * Locality name [Vancouver]: enter
  * Organization name [LQWD]: enter 
  * Organizational unit name [DEVOPS]: {{dev}}
  * Common name [newdeveloper]: enter
  * Name [EasyRSA]: enter
  * Email Address []: {{newdeveloper@lqwd.money}}
  * Challenge password: enter
  * Confirm password: enter
  * Sign the certificate: y
  * Commit: y
* ls /etc/openvpn/easy-rsa/keys | grep $CLIENT_NAME
* cp keys/client.template.ovpn /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* echo '<ca>' >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* cat /etc/openvpn/ca.crt >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* echo '</ca>' >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* echo '<cert>' >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* cat /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.crt >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* echo '</cert>' >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* echo '<key>' >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* cat /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.key >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* echo '</key>' >> /etc/openvpn/easy-rsa/keys/$CLIENT_NAME.ovpn
* touch ../ccd/$CLIENT_NAME

## Release the config file
the file in the following link can be sent to who needs to get connected
```
/etc/openvpn/easy-rsa/keys/{{newdeveloper}}.ovpn
```