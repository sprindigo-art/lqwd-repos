package lqwd.frontend.configuration;



import lqwd.frontend.httpclient.CheckTokenResponse;
import lqwd.frontend.httpclient.HttpClientToken;
import org.apache.http.HttpEntity;
import org.apache.http.HttpHeaders;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.mime.MultipartEntityBuilder;
import org.apache.http.entity.mime.content.StringBody;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.util.EntityUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.servlet.FilterChain;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

public class JWTAuthorizationFilter extends OncePerRequestFilter {

	private final String HEADER = "Authorization";
	private final String PREFIX = "Bearer ";

	@Value("${app.auth_post_url}")
	private String authPostUrl;

	@Value("${app.auth_post_port}")
	private String authPostUrlPort;

	@Value("${app.auth_user_name}")
	private String authUserName;

	@Value("${app.auth_password}")
	private String authPassword;

	@Value("${app.auth_client_id}")
	private String authClientId;

	@Value("${app.auth_grand_type}")
	private String authGrandType;

	@Autowired
	HttpClientToken httpClientToken;

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
		try {
			if (checkJWTToken(request, response)) {
				CheckTokenResponse checkTokenResponse = validateToken1(request);
				if (checkTokenResponse.isValid()) {
					setUpSpringAuthentication();
				} else {
					SecurityContextHolder.clearContext();
				}
//				Claims claims = validateToken(request);
//				if (claims.get("authorities") != null) {
//					setUpSpringAuthentication(claims);
//				} else {
//					SecurityContextHolder.clearContext();
//				}

				chain.doFilter(request, response);
			} else {
				response.setStatus(HttpServletResponse.SC_FORBIDDEN);
				((HttpServletResponse) response).sendError(HttpServletResponse.SC_FORBIDDEN, "Need token for access");
				return;
			}
		} catch (Exception e) {
			response.setStatus(HttpServletResponse.SC_FORBIDDEN);
			((HttpServletResponse) response).sendError(HttpServletResponse.SC_FORBIDDEN, e.getMessage());
			return;
		}
	}

	private CheckTokenResponse validateToken1(HttpServletRequest request) {
		String jwtToken = request.getHeader(HEADER).replace(PREFIX, "");
		CheckTokenResponse checkTokenResponse = checkToken(jwtToken);
		return checkTokenResponse;
	}

//	private Claims validateToken(HttpServletRequest request) {
//		String jwtToken = request.getHeader(HEADER).replace(PREFIX, "");
////		CheckTokenResponse checkTokenResponse= httpClientToken.checkToken(jwtToken);
//		Claims cl = Jwts.parser().setSigningKey(SECRET.getBytes()).parseClaimsJws(jwtToken).getBody();
//		return cl;
//	}

	/**
	 * Authentication method in Spring flow
	 *
	 */
	private void setUpSpringAuthentication() {
		@SuppressWarnings("unchecked")
		List<String> authorities = new ArrayList<>();
		authorities.add("ROLE_USER");
		UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
				"user", null,
				authorities.stream().map(SimpleGrantedAuthority::new).collect(Collectors.toList()));
		SecurityContextHolder.getContext().setAuthentication(auth);

	}

	private boolean checkJWTToken(HttpServletRequest request, HttpServletResponse res) {
		String authenticationHeader = request.getHeader(HEADER);
		if (authenticationHeader == null || !authenticationHeader.startsWith(PREFIX))
			return false;
		return true;
	}

	private CheckTokenResponse checkToken(String token){
		CheckTokenResponse checkTokenResponse = new CheckTokenResponse();
		String content = null;
		CloseableHttpClient client = HttpClientBuilder.create().build();

		HttpPost postRequest = new HttpPost(String.format("http://%s:%s/oauth/check_token", this.authPostUrl, this.authPostUrlPort));

		String encoding = java.util.Base64.getEncoder()
				.encodeToString((this.authUserName + ":"
						+ this.authPassword).getBytes());


		postRequest.setHeader(HttpHeaders.AUTHORIZATION, "Basic " + encoding);

		postRequest.addHeader(HttpHeaders.ACCEPT, "application/json");
		// postRequest.addHeader(HttpHeaders.CONTENT_TYPE, "multipart/form-data");


		HttpEntity entity = MultipartEntityBuilder
				.create()
				.addPart("token", new StringBody(token, ContentType.MULTIPART_FORM_DATA))
				.addPart("client_id", new StringBody(authClientId, ContentType.MULTIPART_FORM_DATA)).build();
		postRequest.setEntity(entity);

		Long timeNowInSec = System.currentTimeMillis()/1000;

		try (CloseableHttpResponse httpResponse = client.execute(postRequest)) {
			content = EntityUtils.toString(httpResponse.getEntity());

			int statusCode = httpResponse.getStatusLine().getStatusCode();
			if (statusCode == 200) {
				checkTokenResponse = checkTokenResponse.mapContent(content);
			} else {
				logger.info("statusCode = " + statusCode);
				logger.info("content = " + content);
			}
		} catch (IOException e) {
			// handle exception
			logger.info(e.getMessage());
//			e.printStackTrace();
		}

		return checkTokenResponse;
	}

}
