package lqwd.frontend.configuration;

import lqwd.frontend.session.Session;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix= "features")
public class ConfigProperties {

    private boolean session_active=true;

}
