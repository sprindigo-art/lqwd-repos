package com.lqwd.security;


//@Component
//public class JWTAuthorizationFilter extends OncePerRequestFilter {
//
//    private final String HEADER = "Authorization";
//    private final String PREFIX = "Bearer ";
//
//    @Value("${app.auth_post_url}")
//    private String appAuthPostUrl;
//
//    @Value("${app.auth_password}")
//    private String appAuthPassword;
//
//    @Value("${app.auth_user_name}")
//    private String appAuthUserName;
//
//    @Value("${app.auth_post_port}")
//    private String appAuthPostPort;
//
//
//    @Autowired
//    private HttpClientToken httpClientToken;
//
//    @Override
//    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
////        try {
////            if (checkJWTToken(request)) {
////                PubkeyResponse pubkeyResponse = validateToken(request);
////                if (pubkeyResponse.isValid()) {
////                    setUpSpringAuthentication();
////                } else {
////                    SecurityContextHolder.clearContext();
////                }
////                chain.doFilter(request, response);
////            } else {
////                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
////                response.sendError(HttpServletResponse.SC_FORBIDDEN, "Add PubKey to header for access");
////            }
////        } catch (ExpiredJwtException | UnsupportedJwtException | MalformedJwtException e) {
////            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
////            response.sendError(HttpServletResponse.SC_FORBIDDEN, e.getMessage());
////        }
//    }
//
//    private PubkeyResponse validateToken(HttpServletRequest request) {
//        String jwtToken = request.getHeader(HEADER).replace(PREFIX, "");
//
//        return this.httpClientToken.checkPubkey(jwtToken);
//
//    }
//
//
//    /**
//     * Authentication method in Spring flow
//     */
//    private void setUpSpringAuthentication() {
//        List<String> authorities = new ArrayList<>();
//        authorities.add("ROLE_USER");
//        UsernamePasswordAuthenticationToken auth = new UsernamePasswordAuthenticationToken(
//                "user", null,
//                authorities.stream().map(SimpleGrantedAuthority::new).collect(Collectors.toList()));
//        SecurityContextHolder.getContext().setAuthentication(auth);
//
//    }
//
//    private boolean checkJWTToken(HttpServletRequest request) {
//        String authenticationHeader = request.getHeader(HEADER);
//        if (authenticationHeader == null || !authenticationHeader.startsWith(PREFIX)) {
//            return false;
//        }
//        return true;
//    }
//
////    private boolean checkBodyUsernamePass(HttpServletRequest request){
////        request.getAttributeNames()
////    }
//
//}
