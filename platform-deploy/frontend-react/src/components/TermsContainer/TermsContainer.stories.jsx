/* eslint-disable */
import React from 'react';
import TermsContainer from "./TermsContainer";
export default {
  title: 'LQWD Components/ Terms Container',
  component: TermsContainer,
};

export const primary = () => {

  const jsonText =[
    {
      header: "",
      subheader: "",
      text: "This Cookies Policy explains what Cookies are and how We use them. " +
        "You should read this policy so You can understand what type of cookies " +
        "We use, or the information We collect using Cookies and how that information is used. " +
        "<br><br>Cookies do not typically contain any information that personally identifies a user, " +
        "but personal information that we store about You may be linked to the information stored in and obtained from Cookies. " +
        "For further information on how We use, store and keep your personal data secure, see our Privacy Policy. " +
        "We do not store sensitive personal information, such as mailing addresses, account passwords, etc. in the Cookies We use."
    },
    {
      header: "Interpretation and Definitions",
      subheader: "Interpretation",
      text: "The words of which the initial letter is capitalized have meanings defined under the following conditions. " +
        "The following definitions shall have the same meaning regardless of whether they appear in singular or in plural.",
    },
    {
      header: "",
      subheader: "Definitions",
      text: "For the purposes of this Cookie Policy:" +
        "<ul><li>Company (referred to as either \"the Company\", \"We\". \"Us\" or \"Our\" in this Cookie Policy) refers to LQwD FinTech Corp.</li>" +
        "<li>Cookies means small files that are placed on Your computer, mobile device, or any other device by a website, containing the details of Your browsing history on that website among its many uses.</li>" +
        "<li>Website refers to LQwD Platform, accessible from lqwd.tech." +
        "<li>You means the individual accessing or using the Service, or the company, or other legal entity on behalf of which such individual is accessing or using the Service, as applicable.</li></ul>",
    },
    {
      header: "The use of the Cookies",
      subheader: "Type of Cookies We Use",
      text: "Cookies can be \"Persistent\" or \"Session\" Cookies. Persistent Cookies remain on Your personal computer or " +
        "mobile device when You go offline, while Session Cookies are deleted as soon as You close Your web browser. " +
        "We use both Session and Persistent Cookies for the purposes set out below: " +
        "Necessary / Essential Cookies " +
        "<ul><li>Type: Session Cookies" +
        "</li><li>Administered by:Us " +
        "</li><li>Purpose: These Cookies are essential to provide You with services available through the Website and " +
        "to enable You to use some of its features. They help to authenticate users and prevent fraudulent " +
        "use of user accounts. Without these Cookies, the services that You have asked for cannot be provided," +
        " and We only use these Cookies to provide You with those services.</li></ul><br>" +
        "Functionality Cookies " +
        "<ul><li>Type: Persistent Cookies " +
        "</li><li>Administered by: Us " +
        "</li><li>Purpose: These Cookies allow us to remember choices You make when You use the Website, " +
        "such as remembering your login details or language preference. " +
        "The purpose of these Cookies is to provide You with a more personal experience and to avoid you having to " +
        "re-enter your preferences every time You use the Website.</li></ul>",
    },
    {
      header: "",
      subheader: "Your Choices Regarding Cookies",
      text: "If You prefer to avoid the use of Cookies on the Website, " +
        "first You must disable the use of Cookies in your browser and " +
        "then delete the Cookies saved in your browser associated with this website. " +
        "You may use this option for preventing the use of Cookies at any time.<br>" +
        "<br>" +
        "If You do not accept Our Cookies, " +
        "You may experience some inconvenience in your use of the Website and some " +
        "features may not function properly.<br>" +
        "<br>" +
        "If You do not accept Our Cookies, " +
        "You may experience some inconvenience in your use of the Website and " +
        "some features may not function properly.<br>" +
        "<br>" +
        "If You'd like to delete Cookies or instruct your web browser to delete or refuse Cookies, please visit the help pages of your web browser.\n" +
        "<br><br>" +
        "<a href=''>For the Chrome web browser, please visit this page from Google:</a><br>" +
        "<a href=''>For the Internet Explorer web browser, please visit this page from Microsoft:</a><br>" +
        "<a href=''>For the Firefox web browser, please visit this page from Mozilla:</a><br>" +
        "<a href=''>For the Safari web browser, please visit this page from Apple:</a><br>" +
        "<a href=''>For any other web browser, please visit your web browser's official web pages</a><br>",
    },
    {
      header: "Contact Us",
      subheader: "",
      text: "If you have any questions about this Cookies Policy, You can contact us by email: <a href='mailto:info@lqwd.money'>info@lqwd.money.</a>"
    }
    ];

  return (
    <div >
      <TermsContainer title={"Terms of Service"} date={"01/01/2022"} json={jsonText}/>
    </div>
  )
}