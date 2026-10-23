package lqwd.frontend.controller;

import com.google.gson.Gson;
import lqwd.frontend.httpclient.HttpClientToken;
import lqwd.frontend.model.User;
import org.hamcrest.Matchers;
import org.junit.Before;
import org.junit.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultHandlers.print;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;


public class RegisterControllerTest extends AbstractTest{


    @Autowired
    private HttpClientToken httpClientToken;

    @Override
    @Before
    public void setUp (){
        super.setUp();
    }

    @Test
    public void testRegistrationGet() throws Exception {
        mvc.perform(get("/registration"))
                .andDo(print())
                .andExpect(status().isOk())
                .andExpect(content().string(Matchers.containsString("User Registration LQWD")))
                .andExpect(view().name("auth/registration"));
    }

    @Test
    public void registrationSuccessfulTest() throws Exception {
        User user = new User("doe@gmail.com","test","testPassword","John","Doe");
        String payload = new Gson().toJson(user);

        mvc.perform(post("/registration").flashAttr("user",user))
                .andExpect(status().isOk());
    }

    @Test
    public void registrationNoEmailTest() throws Exception {
        User user = new User(null,"test","testPassword","John","Doe");
        String payload = new Gson().toJson(user);

        mvc.perform(post("/registration").flashAttr("user",user))
                .andExpect(status().isBadRequest());
    }

}
