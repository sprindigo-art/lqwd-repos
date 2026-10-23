package lqwd.frontend.captcha;


public interface ICaptchaService {
    
    default void processResponse(final String response)  {}
    
    boolean processResponse(final String response, String action);
    
    String getReCaptchaSite();

    String getReCaptchaSecret();
}