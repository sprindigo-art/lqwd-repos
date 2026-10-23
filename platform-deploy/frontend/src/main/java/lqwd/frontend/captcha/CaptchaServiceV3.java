package lqwd.frontend.captcha;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClientException;

import java.net.URI;

@Service("captchaServiceV3")
public class CaptchaServiceV3 extends AbstractCaptchaService {

    private final static Logger LOGGER = LoggerFactory.getLogger(CaptchaServiceV3.class);
    
    public static final String REGISTER_ACTION = "register";
    public static final String SUBSCRIBE_BETA_ACTION = "subscribe";
    
    @Override
    public boolean processResponse(String response, final String action) {

        if(!securityCheck(response))
            return false;
        
        final URI verifyUri = URI.create(String.format(RECAPTCHA_URL_TEMPLATE, getReCaptchaSecret(), response, getClientIP()));
        try {
            final GoogleResponse googleResponse = restTemplate.getForObject(verifyUri, GoogleResponse.class);
            LOGGER.debug("Google's response: {} ", googleResponse.toString());

            if (!googleResponse.isSuccess() || !googleResponse.getAction().equals(action) || googleResponse.getScore() < captchaSettings.getThreshold()) {
                return false;
            }
        } catch (RestClientException rce) {
            return false;
        }

        return true;
    } 
}