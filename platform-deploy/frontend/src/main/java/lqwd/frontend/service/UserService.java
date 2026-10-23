package lqwd.frontend.service;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.httpclient.TokenKey;
import lqwd.frontend.model.BitcoinPrice;
import lqwd.frontend.model.User;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.util.EntityUtils;
import org.jboss.aerogear.security.otp.Totp;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import lqwd.frontend.repository.BitcoinPriceRepository;

@Service("userService")
public class UserService {

    @Autowired
    private BitcoinPriceRepository bitcoinPriceRepository;

    @Value("${app.auth_post_url}")
    private String appAuthPostUrl;

    @Value("${app.auth_password}")
    private String appAuthPassword;

    @Value("${app.auth_user_name}")
    private String appAuthUserName;

    @Value("${app.auth_post_port}")
    private String appAuthPostPort;

    @Value("${app.auth_client_id}")
    private String appAuthClientId;

    @Value("${features.session_active}")
    private boolean isSessionActive;

    private static Logger logger = LoggerFactory.getLogger(UserService.class);

    // to save user after registration
    public String saveUser(User user) throws UnsupportedEncodingException {
        String content = null;
        CloseableHttpClient client = HttpClientBuilder.create().build();

        HttpPost postRequest = new HttpPost(String.format("http://%s:%s/login/registration",this.appAuthPostUrl,this.appAuthPostPort));


        String encoding = java.util.Base64.getEncoder()
                .encodeToString((this.appAuthUserName + ":"
                        + this.appAuthPassword).getBytes());


        postRequest.addHeader(HttpHeaders.AUTHORIZATION, "Basic " + encoding);
        postRequest.addHeader("Content-type", "application/x-www-form-urlencoded");

        List<NameValuePair> params = new ArrayList<>();
        params.add(new BasicNameValuePair("email", user.getEmail()));
        params.add(new BasicNameValuePair("username", user.getUsername()));
        params.add(new BasicNameValuePair("password", user.getPassword()));
        params.add(new BasicNameValuePair("firstname", user.getFirstName()));
        params.add(new BasicNameValuePair("lastname", user.getLastName()));
        params.add(new BasicNameValuePair("fa2", String.valueOf(true)));

        HttpEntity entity = new UrlEncodedFormEntity(params);
        postRequest.setEntity(entity);

        try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
            content = EntityUtils.toString(httpResponse.getEntity());
            int statusCode = httpResponse.getStatusLine().getStatusCode();

            if (statusCode == 200) {
                return content;
            } else {
                logger.info("statusCode = " + statusCode);
                logger.info("content = " + content);
            }
        } catch (IOException e) {
            // handle exception
            logger.info(e.getMessage());
//            e.printStackTrace();
        }

        return content;
    }

    /*
        Cookie Methods
     */
    //create and save cookie
    public void createCookie(String token, HttpServletResponse response) {

        Cookie cookie = new Cookie("token", token);
        cookie.setMaxAge(60 * 60 * 4);
        cookie.setHttpOnly(true);
//        cookie.setSecure(true);
        response.addCookie(cookie);

    }


    public void createTokenValidityPeriodCookie(String validityPeriod, HttpServletResponse response) {

        Cookie cookie = new Cookie("token-validity", validityPeriod);
        cookie.setMaxAge(60 * 60 * 4);
        cookie.setHttpOnly(true);
//        cookie.setSecure(true);
        response.addCookie(cookie);

    }

    //remove cookie
    public void removeCookie(HttpServletResponse response) {

        Cookie cookie = new Cookie("token", null);
        cookie.setHttpOnly(true);
//        cookie.setSecure(true);
        response.addCookie(cookie);

    }

    //get session token if stored in cookie
    public String getCookieToken(HttpServletRequest request) {

        String token = null;
        Cookie cookies[] = request.getCookies();
        for (Cookie cookie : cookies) {
            if (cookie.getName().equals("token")) {
                token = cookie.getValue();
            }
        }
        return token;
    }

    /*
        Session Methods
     */
    //set sessionToken if flag is enabled
    public void setSessionToken(HttpSession session, TokenKey token) {
        session.setAttribute("tokenKey", token);
    }

    //get sessionToken if flag is enabled
    public TokenKey getSessionToken(HttpSession session) {

        TokenKey tokenKey = (TokenKey) session.getAttribute("tokenKey");

        return tokenKey;

    }

    //invalidate session
    public void endSession(HttpSession session) {
        session.invalidate();
    }

    //set currency
    public void setSessionCurrency(HttpSession session, String currency) {
        session.setAttribute("currency", currency);
    }

    //set light or dark mode
    public void setSessionLightDarkMode(HttpSession session, Boolean light) {
        session.setAttribute("light", light);
    }

    //set lnd name for session
    public void setSessionLnd(HttpSession session, String lnd_name) {
        session.setAttribute("lnd", lnd_name);
    }


    //get currency from session
    public Boolean getSessionLightDarkMode(HttpSession session) {
        Boolean light = (Boolean) session.getAttribute("light");


        if (light == null){
            light = false;
        }

        return light;
    }

    //get currency from session
    public String getSessionCurrency(HttpSession session) {
        String currency = (String) session.getAttribute("currency");


        if (currency == null){
            currency = "satoshi";
        }

        return currency;
    }

    //get lnd from session
    public String getSessionLnd(HttpSession session) {
        String lnd = (String) session.getAttribute("lnd");

        if (lnd == null){
            return  null;
        }

        return lnd;
    }
    /*
        Create and Get Session Information using these methods (this will use cookies or sessions depending on flag
     */
    //check whether it is a session or cookie to save token into
    public void saveSessionInfo(HttpServletResponse response, HttpSession session, TokenKey tokenKey, String currency, Boolean light) {

        if (isSessionActive) {
            setSessionToken(session, tokenKey);
            if (currency == null) {
                String sessionCurrency = getSessionCurrency(session);
                if (sessionCurrency == null){
                    setSessionCurrency(session, "satoshi");
                }else {
                    setSessionCurrency(session, sessionCurrency);
                }
            } else {
                setSessionCurrency(session, currency);
            }

            if (light == null){
                Boolean sessionLight = getSessionLightDarkMode(session);
                setSessionLightDarkMode(session, sessionLight);
            }else{
                setSessionLightDarkMode(session, light);
            }
//            createTokenValidityPeriodCookie(tokenKey.getExpires_in().toString()+"|"+tokenKey.getRequestedSystemTime(),response);
        } else {
            createCookie(tokenKey.getAccess_token(), response);
        }
    }

    public void saveSessionInfo(HttpServletResponse response, HttpSession session, TokenKey tokenKey, String currency, Boolean light, String lnd_name) {

        if (isSessionActive) {
            setSessionToken(session, tokenKey);
            if (currency == null) {
                String sessionCurrency = getSessionCurrency(session);
                if (sessionCurrency == null){
                    setSessionCurrency(session, "satoshi");
                }else {
                    setSessionCurrency(session, sessionCurrency);
                }
            } else {
                setSessionCurrency(session, currency);
            }

            if (light == null){
                Boolean sessionLight = getSessionLightDarkMode(session);
                setSessionLightDarkMode(session, sessionLight);
            }else{
                setSessionLightDarkMode(session, light);
            }

            if (lnd_name == null){
                String lnd = getSessionLnd(session);
                setSessionLnd(session, lnd);
            }else{
                setSessionLnd(session, lnd_name);
            }

//            createTokenValidityPeriodCookie(tokenKey.getExpires_in().toString()+"|"+tokenKey.getRequestedSystemTime(),response);
        } else {
            createCookie(tokenKey.getAccess_token(), response);
        }
    }

    //check whether it is a session or cookie to be checked and return token
    public TokenKey getSessionInfo(HttpServletRequest request, HttpSession session) {
        TokenKey tokenKey = new TokenKey();
        if (isSessionActive) {
            tokenKey = getSessionToken(session);
        } else {
            tokenKey.setAccess_token(getCookieToken(request));
        }

        return tokenKey;
    }

    //check whether it is a session or cookie to be removed and remove it
    public void removeSessionInfo(HttpServletResponse response, HttpSession session) {
        if (isSessionActive) {
            endSession(session);
        } else {
            removeCookie(response);
        }
    }

    //Two Factor Auth methods

    //set APP_Name and QR_Prefic for generating QR code
    private static String APP_NAME = "LQwD";

    private static String QR_PREFIX = "https://chart.googleapis.com/chart?chs=200x200&chld=M%%7C0&cht=qr&chl=";

    //method to generate qr code
    public String generateQRUrl(User user) throws UnsupportedEncodingException {
        return QR_PREFIX + URLEncoder.encode(
                String.format(
                        "otpauth://totp/%s:%s?secret=%s&issuer=%s",
                        APP_NAME,
                        user.getEmail(),
                        user.getFa2secret(),
                        APP_NAME),
                "UTF-8");
    }

    //check code is a valid code
    public boolean isValidLong(String code) {
        try {
            Long.parseLong(code);
        } catch (final NumberFormatException e) {
            return false;
        }
        return true;
    }

    public boolean isCodeValid(String f2aSecret, String code) {
        Totp totp = new Totp(f2aSecret);

        return (!isValidLong(code) || !totp.verify(code));
    }

    //check if user is verified
    public boolean isVerified(TokenKey tokenKey) throws IOException {
        HttpClientToken httpClientToken = new HttpClientToken();

        if (tokenKey != null) {
            if (tokenKey.getAccess_token() != null) {

                User user = httpClientToken.getUser(tokenKey.getAccess_token());
                return user.isEmailstatus();
            }
        }
        return false;
    }

    //check if request is ajax
    public boolean isAjax(HttpServletRequest request) {
        if (request.getHeader("X-Requested-With") != null) {
            return request.getHeader("X-Requested-With").equals("XMLHttpRequest");
        } else {
            return false;
        }
    }

    //create qr code given text
    public static BitMatrix generateAddressQrCode(String barcodeText) throws Exception {
        QRCodeWriter barcodeWriter = new QRCodeWriter();
        BitMatrix bitMatrix = barcodeWriter.encode(barcodeText, BarcodeFormat.QR_CODE, 250, 250);

        return bitMatrix;
    }

    //get BTC to USD & CAD price
    public BitcoinPrice getBTCPrice() throws URISyntaxException {

        BitcoinPrice bitcoinPrice = bitcoinPriceRepository.getLatestPrice();

        return bitcoinPrice;
    }

}
